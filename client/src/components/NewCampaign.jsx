import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, LoaderCircle, PencilRuler, Rocket, Send, TriangleAlert, Workflow } from 'lucide-react'
import { applyFilters } from '@shared/filters.js'
import { detectPhoneColumn, prepareContacts } from '@shared/phone.js'
import { DEFAULT_WINDOW } from '@shared/schedule.js'
import { startNode, usesList, workflowProblems } from '@shared/workflow.js'
import { api } from '../api.js'
import { browserTimeZone, formatWhen, nextFullHour, storageGet, storageSet, toLocalInput } from '../utils.js'
import CsvImport from './CsvImport.jsx'
import TemplateEditor from './TemplateEditor.jsx'
import MediaPicker, { EMPTY_MEDIA, mediaProblem } from './MediaPicker.jsx'
import SendSettings from './SendSettings.jsx'
import MessagePreview from './MessagePreview.jsx'
import { ListenerStatus, useResponses } from './FlowResults.jsx'

const EMPTY_FILTERS = { match: 'all', rules: [] }

const DEFAULT_SETTINGS = {
  minDelay: 8,
  maxDelay: 20,
  batchSize: 50,
  batchPause: 5,
  typingSeconds: 3,
  validateNumbers: true,
  linkPreview: false,
  window: DEFAULT_WINDOW,
}

function Section({ step, title, children, aside }) {
  return (
    <section className="card">
      <div className="card-head">
        <span className="step">{step}</span>
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export default function NewCampaign({ instance, onCreated, workflowsVersion, onEditWorkflow }) {
  const [csv, setCsv] = useState(null)
  const [phoneColumn, setPhoneColumn] = useState('')
  const [countryCode, setCountryCode] = useState(() => storageGet('disparos.countryCode', '55'))
  const [template, setTemplate] = useState(() => storageGet('disparos.template', ''))
  const [settings, setSettings] = useState(() => {
    const saved = storageGet('disparos.settings', {})
    return { ...DEFAULT_SETTINGS, ...saved, window: { ...DEFAULT_WINDOW, ...saved.window } }
  })
  const [when, setWhen] = useState('now') // 'now' | 'schedule'
  const [scheduleInput, setScheduleInput] = useState(() => toLocalInput(nextFullHour()))
  const [media, setMedia] = useState(EMPTY_MEDIA)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // 'simple' = só a mensagem; 'workflow' = a mensagem com os botões e o caminho de um workflow
  const [mode, setMode] = useState(() => storageGet('disparos.mode', 'simple'))
  const [workflowId, setWorkflowId] = useState(() => storageGet('disparos.workflowId', ''))
  const [workflows, setWorkflows] = useState([])
  const [workflow, setWorkflow] = useState(null)
  const [name, setName] = useState('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [seed, setSeed] = useState(1)
  const [testNumber, setTestNumber] = useState(() => storageGet('disparos.testNumber', ''))
  const [busy, setBusy] = useState('') // 'test' | 'start'
  const [feedback, setFeedback] = useState(null) // { tone, text, source: 'test' | 'start' }
  const useWorkflow = mode === 'workflow'
  const responses = useResponses(useWorkflow)
  const startChoices = useWorkflow ? startNode(workflow)?.data.choices || [] : []
  const withButtons = startChoices.length > 0

  // Guarda rascunho do template e preferências no navegador
  useEffect(() => storageSet('disparos.template', template), [template])
  useEffect(() => storageSet('disparos.settings', settings), [settings])
  useEffect(() => storageSet('disparos.countryCode', countryCode), [countryCode])
  useEffect(() => storageSet('disparos.testNumber', testNumber), [testNumber])
  useEffect(() => storageSet('disparos.mode', mode), [mode])
  useEffect(() => storageSet('disparos.workflowId', workflowId), [workflowId])

  // A lista volta a ser lida quando um workflow é salvo na aba Workflows
  useEffect(() => {
    api
      .workflows()
      .then((list) => {
        setWorkflows(list)
        setWorkflowId((id) => (list.some((w) => w.id === id) ? id : list[0]?.id || ''))
      })
      .catch(() => setWorkflows([]))
  }, [workflowsVersion])

  useEffect(() => {
    if (!workflowId) return setWorkflow(null)
    let alive = true
    api
      .workflow(workflowId)
      .then((wf) => alive && setWorkflow(wf))
      .catch(() => alive && setWorkflow(null))
    return () => {
      alive = false
    }
  }, [workflowId, workflowsVersion])

  // Botões aceitam imagem, vídeo ou documento no cabeçalho — não áudio
  useEffect(() => {
    if (withButtons && (media.type === 'audio' || media.type === 'ptt')) setMedia((m) => ({ ...m, type: 'image' }))
  }, [withButtons, media.type])

  const filtered = useMemo(() => (csv ? applyFilters(csv.rows, filters) : { rows: [], indexes: [] }), [csv, filters])
  const prepared = useMemo(
    () =>
      csv && phoneColumn
        ? prepareContacts(filtered.rows, phoneColumn, countryCode, filtered.indexes)
        : { contacts: [], stats: { valid: 0, invalid: 0, duplicates: 0 } },
    [csv, filtered, phoneColumn, countryCode],
  )
  const validContacts = useMemo(() => prepared.contacts.filter((c) => c.status === 'pending'), [prepared])
  const safeIndex = Math.min(previewIndex, Math.max(0, validContacts.length - 1))

  const loadCsv = (data) => {
    setCsv(data)
    setFilters(EMPTY_FILTERS)
    setPhoneColumn(detectPhoneColumn(data.headers, data.rows))
    setPreviewIndex(0)
    setFeedback(null)
    if (!name) setName(data.fileName.replace(/\.[^.]+$/, ''))
  }

  const startAt = when === 'schedule' && scheduleInput ? new Date(scheduleInput).getTime() : null

  const cleanSettings = () => {
    const s = { ...settings, timeZone: browserTimeZone() }
    for (const k of ['minDelay', 'maxDelay', 'batchSize', 'batchPause', 'typingSeconds']) s[k] = Number(s[k]) || 0
    if (s.minDelay < 1) s.minDelay = 1
    if (s.maxDelay < s.minDelay) s.maxDelay = s.minDelay
    return s
  }

  /** Converte a mídia da tela para o formato da API, enviando o arquivo uma única vez. */
  const mediaPayload = async () => {
    if (media.mode === 'none') return null
    if (media.mode === 'url') {
      if (!/^https?:\/\//i.test(media.url.trim())) throw new Error('Informe uma URL válida (http/https) para a mídia.')
      return { type: media.type, url: media.url.trim(), fileName: media.url.split('/').pop() }
    }
    if (!media.file) throw new Error('Escolha o arquivo de mídia ou remova o anexo.')
    // O arquivo já foi enviado em partes ao ser escolhido (MediaPicker)
    const problem = mediaProblem(media)
    if (problem) throw new Error(problem)
    return { type: media.type, uploadId: media.uploadId, fileName: media.file.name, mimetype: media.file.type }
  }

  const wfProblems = useWorkflow && workflow ? workflowProblems(workflow) : []

  const problems = []
  if (!csv) problems.push('Importe o CSV com os contatos.')
  else if (!filtered.rows.length) problems.push('Nenhuma linha atende aos filtros.')
  else if (!validContacts.length) problems.push('Nenhum telefone válido na coluna selecionada.')
  if (!template.trim() && (media.mode === 'none' || withButtons)) problems.push('Escreva a mensagem.')
  if (useWorkflow && !workflowId) problems.push('Escolha o workflow (ou crie um na aba Workflows).')
  if (wfProblems.length) problems.push(`O workflow “${workflow.name}” tem problemas. Abra no editor para corrigir.`)
  if (when === 'schedule' && (!startAt || Number.isNaN(startAt))) problems.push('Escolha a data e hora do agendamento.')
  else if (startAt && startAt < Date.now()) problems.push('A data do agendamento já passou.')
  const w = settings.window
  if (w.enabled && (!w.days.length || !w.start || !w.end || w.end <= w.start)) problems.push('Ajuste a janela de envio.')
  if (media.mode === 'file' && !media.file) problems.push('Escolha o arquivo de mídia.')
  const uploadProblem = mediaProblem(media)
  if (uploadProblem) problems.push(uploadProblem)
  if (media.mode === 'url' && !media.url.trim()) problems.push('Informe a URL da mídia.')
  if (instance && !instance.configured) problems.push('Configure a conexão com a uazapi.')

  const sendTest = async () => {
    setBusy('test')
    setFeedback(null)
    try {
      const res = await api.testSend({
        number: testNumber,
        countryCode,
        template,
        vars: validContacts[safeIndex]?.vars || {},
        media: await mediaPayload(),
        settings: cleanSettings(),
        workflowId: useWorkflow ? workflowId : undefined,
      })
      const text = res.flow
        ? `Teste enviado para +${res.number}. Responda no seu WhatsApp para percorrer o workflow.`
        : `Mensagem de teste enviada para +${res.number}.`
      setFeedback({ tone: 'ok', text, source: 'test' })
    } catch (err) {
      setFeedback({ tone: 'bad', text: err.message, source: 'test' })
    } finally {
      setBusy('')
    }
  }

  const start = async () => {
    const total = validContacts.length.toLocaleString('pt-BR')
    const question = startAt
      ? `Agendar o disparo para ${total} contatos em ${formatWhen(startAt)}?`
      : `Iniciar o disparo para ${total} contatos agora?`
    if (!window.confirm(question)) return
    setBusy('start')
    setFeedback(null)
    try {
      const campaign = await api.createCampaign({
        name,
        template,
        media: await mediaPayload(),
        settings: cleanSettings(),
        rows: csv.rows,
        phoneColumn,
        countryCode,
        filters,
        workflowId: useWorkflow ? workflowId : undefined,
        startAt,
      })
      setCsv(null)
      setFilters(EMPTY_FILTERS)
      setWhen('now')
      setName('')
      setMedia(EMPTY_MEDIA)
      onCreated(campaign.id)
    } catch (err) {
      setFeedback({ tone: 'bad', text: err.message, source: 'start' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="new-campaign">
      <div className="col-main">
        <Section step="1" title="Contatos">
          <CsvImport
            csv={csv}
            onLoad={loadCsv}
            onClear={() => setCsv(null)}
            phoneColumn={phoneColumn}
            setPhoneColumn={setPhoneColumn}
            countryCode={countryCode}
            setCountryCode={setCountryCode}
            stats={prepared.stats}
            filters={filters}
            setFilters={setFilters}
            filteredRows={filtered.rows}
          />
        </Section>

        <Section step="2" title="Mensagem">
          <div className="segmented" role="radiogroup" aria-label="Formato da mensagem">
            {[
              ['simple', 'Mensagem simples'],
              ['workflow', 'Com workflow'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={mode === value ? 'active' : ''}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {useWorkflow && (
            <div className="wf-pick">
              <label className="field">
                <span>Workflow</span>
                <div className="input-group">
                  <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
                    {!workflows.length && <option value="">Nenhum workflow criado</option>}
                    {workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.problems.length ? ' (com problemas)' : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={() => onEditWorkflow(workflowId || null)}>
                    {workflowId ? <PencilRuler size={16} /> : <Workflow size={16} />} {workflowId ? 'Editar' : 'Criar'}
                  </button>
                </div>
              </label>
              {workflow && (
                <p className="muted small">
                  {withButtons
                    ? `A mensagem vai com ${usesList(startNode(workflow)) ? 'uma lista de' : 'os botões'} ${startChoices.map((c) => `“${c.label}”`).join(', ')}. `
                    : 'A mensagem vai sem botões e o workflow segue logo depois dela. '}
                  As respostas seguem o caminho montado no canvas ({workflow.blocks} blocos).
                </p>
              )}
              {wfProblems.length > 0 && (
                <ul className="problems">
                  {wfProblems.slice(0, 5).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <TemplateEditor template={template} setTemplate={setTemplate} headers={csv?.headers || []} />
          <h3 className="subhead">{withButtons ? 'Imagem no topo da mensagem' : 'Anexo'}</h3>
          <MediaPicker media={media} setMedia={setMedia} allowAudio={!withButtons} server={instance?.server} />
        </Section>

        <Section step="3" title="Ritmo de envio">
          <SendSettings settings={settings} setSettings={setSettings} count={validContacts.length} startAt={startAt} />
        </Section>
      </div>

      <aside className="col-side">
        <MessagePreview
          template={template}
          media={media}
          workflow={useWorkflow ? workflow : null}
          separateMedia={Boolean(
            withButtons &&
              (usesList(startNode(workflow)) ||
                (['video', 'document'].includes(media.type) && instance?.server?.version && !instance.server.buttonMedia)),
          )}
          contacts={validContacts}
          index={safeIndex}
          setIndex={setPreviewIndex}
          seed={seed}
          onReshuffle={() => setSeed((s) => s + 7919)}
        />

        <section className="card">
          <h3 className="card-title">Enviar teste</h3>
          <p className="muted small">
            Envia a mensagem do contato exibido na prévia para o seu número
            {useWorkflow ? '. Responda no seu WhatsApp para percorrer o workflow inteiro.' : '.'}
          </p>
          {useWorkflow && <ListenerStatus status={responses} />}
          <div className="input-group">
            <input
              placeholder="Ex.: 11 98765-4321"
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              inputMode="tel"
            />
            <button className="btn" onClick={sendTest} disabled={!testNumber.trim() || !!busy}>
              {busy === 'test' ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Testar
            </button>
          </div>
          {feedback?.source === 'test' && <div className={`callout ${feedback.tone}`}>{feedback.text}</div>}
        </section>

        <section className="card launch">
          <label className="field">
            <span>Nome da campanha</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Promoção de outubro" maxLength={120} />
          </label>

          <div className="field">
            <span>Quando enviar</span>
            <div className="segmented" role="radiogroup" aria-label="Quando enviar">
              {[
                ['now', 'Agora'],
                ['schedule', 'Agendar'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={when === value}
                  className={when === value ? 'active' : ''}
                  onClick={() => setWhen(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {when === 'schedule' && (
              <>
                <input
                  type="datetime-local"
                  value={scheduleInput}
                  min={toLocalInput(Date.now())}
                  onChange={(e) => setScheduleInput(e.target.value)}
                  aria-label="Data e hora do disparo"
                />
                {startAt > Date.now() && <small className="muted">Começa {formatWhen(startAt)}. O servidor precisa estar ligado nesse horário.</small>}
              </>
            )}
          </div>

          {problems.length > 0 && (
            <ul className="problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {instance?.configured && instance.connected === false && (
            <div className="callout warn small">
              <TriangleAlert size={16} /> A instância não está conectada ao WhatsApp.
            </div>
          )}
          {feedback?.source === 'start' && <div className={`callout ${feedback.tone}`}>{feedback.text}</div>}

          <button className="btn primary large" disabled={problems.length > 0 || !!busy} onClick={start}>
            {busy === 'start' ? (
              <LoaderCircle size={18} className="spin" />
            ) : when === 'schedule' ? (
              <CalendarClock size={18} />
            ) : (
              <Rocket size={18} />
            )}
            {when === 'schedule' ? 'Agendar disparo' : 'Iniciar disparo'}
            {validContacts.length ? ` (${validContacts.length.toLocaleString('pt-BR')})` : ''}
          </button>
        </section>
      </aside>
    </div>
  )
}
