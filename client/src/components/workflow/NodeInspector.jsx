import { useRef, useState } from 'react'
import { LoaderCircle, Plus, Send, Trash2 } from 'lucide-react'
import { OPERATORS } from '@shared/filters.js'
import { FIELD_TYPES, WHATSAPP_COLUMN } from '@shared/datafields.js'
import { ANSWER_TYPES, LIMITS, NODE_TYPES, TIMEOUT_UNITS, usesList } from '@shared/workflow.js'
import { api } from '../../api.js'

/** Botões que inserem {{variável}} no último campo de texto focado. */
function VarChips({ names, onPick }) {
  if (!names.length) return null
  return (
    <div className="var-chips">
      <span className="muted small">Variáveis:</span>
      {names.map((n) => (
        <button key={n} type="button" className="var-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(n)}>
          {`{{${n}}}`}
        </button>
      ))}
    </div>
  )
}

/** Textarea com inserção de variáveis na posição do cursor. */
function TemplateArea({ label, value, onChange, vars, rows = 3, placeholder, hint }) {
  const ref = useRef(null)
  const insert = (name) => {
    const el = ref.current
    const token = `{{${name}}}`
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <label className="field">
      <span>{label}</span>
      <textarea ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <VarChips names={vars} onPick={insert} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

function TextField({ label, value, onChange, maxLength, placeholder, hint, list }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={placeholder} list={list} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

/** As opções (botões ou lista). Cada uma vira uma saída do bloco no canvas. */
function ChoicesEditor({ data, set }) {
  const choices = data.choices || []
  const list = usesList({ data })
  const setChoice = (i, patch) => set({ choices: choices.map((c, k) => (k === i ? { ...c, ...patch } : c)) })
  return (
    <div className="field">
      <span>Opções {choices.length ? `(${list ? 'lista' : 'botões'})` : ''}</span>
      {choices.length === 0 && <small className="muted">Sem opções, a mensagem segue direto para o próximo bloco.</small>}
      <div className="options-list">
        {choices.map((c, i) => (
          <div className="option-row wf-choice" key={i}>
            <span className="option-num">{i + 1}</span>
            <input
              value={c.label}
              onChange={(e) => setChoice(i, { label: e.target.value })}
              maxLength={list ? LIMITS.listLabel : LIMITS.buttonLabel}
              placeholder="Texto da opção"
              aria-label={`Texto da opção ${i + 1}`}
            />
            <input
              className="wf-tag-input"
              value={c.tag}
              onChange={(e) => setChoice(i, { tag: e.target.value })}
              maxLength={30}
              placeholder="Etiqueta"
              title="Etiqueta (opcional): marca o contato, ex.: Qualificado. Vira contagem e filtro nos resultados."
              aria-label={`Etiqueta da opção ${i + 1}`}
            />
            <button type="button" className="icon-btn" onClick={() => set({ choices: choices.filter((_, k) => k !== i) })} aria-label="Remover opção">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="options-foot">
        <button
          type="button"
          className="btn small"
          disabled={choices.length >= LIMITS.choices}
          onClick={() => set({ choices: [...choices, { label: '', tag: '' }] })}
        >
          <Plus size={14} /> Adicionar opção
        </button>
        <small className="muted">
          Até {LIMITS.buttons} viram botões (máx. {LIMITS.buttonLabel} caracteres); acima disso, lista (até {LIMITS.choices}). O contato
          também pode digitar o número ou o texto da opção.
        </small>
      </div>
      {list && (
        <TextField label="Texto do botão que abre a lista" value={data.listButton} onChange={(listButton) => set({ listButton })} maxLength={20} />
      )}
      {choices.length > 0 && (
        <>
          <TextField label="Rodapé (opcional)" value={data.footer} onChange={(footer) => set({ footer })} maxLength={60} />
          <TextField
            label="Guardar a opção escolhida na variável (opcional)"
            value={data.saveAs}
            onChange={(saveAs) => set({ saveAs })}
            maxLength={40}
            placeholder="Ex.: faixa_faturamento"
            hint="Depois, use {{nome_da_variavel}} em mensagens, condições e webhooks."
          />
        </>
      )}
    </div>
  )
}

/** "Sem resposta": a saída extra que leva a um lembrete ou a outro caminho. */
function TimeoutEditor({ timeout, set }) {
  const t = timeout || { enabled: false, amount: 24, unit: 'h' }
  const patch = (p) => set({ timeout: { ...t, ...p } })
  return (
    <div className="field wf-timeout">
      <label className="check">
        <input type="checkbox" checked={t.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        <span>
          Se não responder em
          <small className="muted">
            Cria a saída “Sem resposta” — ligue-a a um lembrete ou a outro caminho. Respeita a janela de envio da campanha, e cada contato
            recebe no máximo {LIMITS.timeoutsPerContact} lembretes.
          </small>
        </span>
      </label>
      {t.enabled && (
        <div className="input-group">
          <input type="number" min={1} max={999} value={t.amount} onChange={(e) => patch({ amount: e.target.value })} aria-label="Prazo" />
          <select value={t.unit} onChange={(e) => patch({ unit: e.target.value })} aria-label="Unidade do prazo">
            {TIMEOUT_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

function MessageFields({ data, set, vars }) {
  const media = data.media
  return (
    <>
      <TemplateArea label="Texto" value={data.text || ''} onChange={(text) => set({ text })} vars={vars} rows={4} />
      <div className="field wf-media">
        <span>Mídia (opcional, por link público)</span>
        <div className="input-group">
          <select
            value={media?.type || 'image'}
            onChange={(e) => set({ media: { ...(media || { url: '' }), type: e.target.value } })}
            aria-label="Tipo da mídia"
          >
            <option value="image">Imagem</option>
            <option value="video">Vídeo</option>
            <option value="document">Documento</option>
            <option value="audio">Áudio</option>
          </select>
          <input
            value={media?.url || ''}
            onChange={(e) => set({ media: e.target.value ? { ...(media || { type: 'image' }), url: e.target.value } : null })}
            placeholder="https://…"
            aria-label="Link da mídia"
          />
        </div>
        {media?.type === 'document' && (
          <input
            value={media.fileName || ''}
            onChange={(e) => set({ media: { ...media, fileName: e.target.value } })}
            placeholder="Nome do arquivo (ex.: proposta.pdf)"
            aria-label="Nome do arquivo"
          />
        )}
      </div>
      <ChoicesEditor data={data} set={set} />
    </>
  )
}

function QuestionFields({ data, set, vars }) {
  return (
    <>
      <TemplateArea label="Pergunta" value={data.text || ''} onChange={(text) => set({ text })} vars={vars} rows={3} />
      <div className="grid-2">
        <TextField label="Guardar a resposta na variável" value={data.saveAs} onChange={(saveAs) => set({ saveAs })} maxLength={40} placeholder="Ex.: email" />
        <label className="field">
          <span>Tipo de resposta</span>
          <select value={data.answerType} onChange={(e) => set({ answerType: e.target.value })}>
            {ANSWER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TemplateArea
        label="Mensagem quando a resposta for inválida (opcional)"
        value={data.invalidText || ''}
        onChange={(invalidText) => set({ invalidText })}
        vars={vars}
        rows={2}
        hint="E-mail, telefone e número são validados. Em branco, usa uma mensagem padrão."
      />
    </>
  )
}

function DataFields({ data, set, vars }) {
  const fields = data.fields || []
  const setField = (i, patch) => set({ fields: fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) })
  return (
    <>
      <TemplateArea label="Mensagem do resumo" value={data.intro || ''} onChange={(intro) => set({ intro })} vars={vars} rows={2} hint="Os dados aparecem logo abaixo, um por linha." />
      <div className="field">
        <span>Dados</span>
        <div className="data-fields">
          {fields.map((f, i) => (
            <div className="data-field" key={i}>
              <div className="data-field-row">
                <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} maxLength={30} placeholder="Nome do dado" aria-label="Nome do dado" />
                <input
                  value={f.column === WHATSAPP_COLUMN ? '' : f.column}
                  disabled={f.column === WHATSAPP_COLUMN}
                  onChange={(e) => setField(i, { column: e.target.value })}
                  placeholder={f.column === WHATSAPP_COLUMN ? 'Número do WhatsApp' : 'Coluna (automática)'}
                  list="wf-vars"
                  title="Coluna da planilha ou variável de onde vem o valor. Em branco, é achada pelo nome do dado."
                  aria-label="Coluna"
                />
                <select value={f.type} onChange={(e) => setField(i, { type: e.target.value })} aria-label="Tipo">
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" disabled={fields.length <= 1} onClick={() => set({ fields: fields.filter((_, k) => k !== i) })} aria-label="Remover dado">
                  <Trash2 size={16} />
                </button>
              </div>
              {f.type === 'phone' && (
                <label className="check small">
                  <input type="checkbox" checked={f.column === WHATSAPP_COLUMN} onChange={(e) => setField(i, { column: e.target.checked ? WHATSAPP_COLUMN : '' })} />
                  <span>Usar o número do WhatsApp</span>
                </label>
              )}
              <input value={f.question} onChange={(e) => setField(i, { question: e.target.value })} placeholder="Pergunta quando o dado faltar ou o contato pedir para alterar" aria-label="Pergunta" />
            </div>
          ))}
        </div>
        <div className="options-foot">
          <button
            type="button"
            className="btn small"
            disabled={fields.length >= LIMITS.dataFields}
            onClick={() => set({ fields: [...fields, { label: '', column: '', type: 'text', question: '' }] })}
          >
            <Plus size={14} /> Adicionar dado
          </button>
          <small className="muted">O que já está na planilha ou nas respostas não é perguntado. Cada dado vira a variável {'{{Nome do dado}}'}.</small>
        </div>
      </div>
      <div className="grid-2">
        <TextField label="Botão de confirmar" value={data.confirmLabel} onChange={(confirmLabel) => set({ confirmLabel })} maxLength={LIMITS.buttonLabel} />
        <TextField label="Botão de alterar" value={data.editLabel} onChange={(editLabel) => set({ editLabel })} maxLength={LIMITS.buttonLabel} />
      </div>
      <TemplateArea label="Antes de perguntar o que falta" value={data.collectIntro || ''} onChange={(collectIntro) => set({ collectIntro })} vars={vars} rows={2} />
      <TemplateArea label="Quando o contato toca em alterar" value={data.editIntro || ''} onChange={(editIntro) => set({ editIntro })} vars={vars} rows={2} />
    </>
  )
}

function ConditionFields({ data, set }) {
  const rules = data.rules || []
  const setRule = (i, patch) => set({ rules: rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) })
  return (
    <>
      <label className="field">
        <span>Segue por “Sim” quando</span>
        <select value={data.match} onChange={(e) => set({ match: e.target.value })}>
          <option value="all">todas as regras valem (E)</option>
          <option value="any">qualquer regra vale (OU)</option>
        </select>
      </label>
      <div className="wf-rules">
        {rules.map((r, i) => {
          const op = OPERATORS.find((o) => o.value === r.op)
          return (
            <div className="wf-rule" key={i}>
              <input value={r.column} onChange={(e) => setRule(i, { column: e.target.value })} placeholder="Coluna ou variável" list="wf-vars" aria-label="Coluna ou variável" />
              <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} aria-label="Operador">
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {!op?.noValue && <input value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} placeholder="Valor (ex.: 80 mil)" aria-label="Valor" />}
              <button type="button" className="icon-btn" disabled={rules.length <= 1} onClick={() => set({ rules: rules.filter((_, k) => k !== i) })} aria-label="Remover regra">
                <Trash2 size={16} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="options-foot">
        <button type="button" className="btn small" disabled={rules.length >= LIMITS.rules} onClick={() => set({ rules: [...rules, { column: '', op: 'eq', value: '' }] })}>
          <Plus size={14} /> Adicionar regra
        </button>
        <small className="muted">
          Vale para colunas da planilha e respostas guardadas. Valores como “R$ 80.000,00”, “80 mil” e “1,5 mi” são entendidos como número.
        </small>
      </div>
    </>
  )
}

function WebhookFields({ data, set, vars, workflow, nodeId }) {
  const fields = data.fields || []
  const [active, setActive] = useState(0)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)
  const refs = useRef([])
  const setField = (i, patch) => set({ fields: fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) })
  const insert = (name) => {
    const i = Math.min(active, fields.length - 1)
    if (i < 0) return
    const el = refs.current[i]
    const token = `{{${name}}}`
    const value = fields[i].value
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    setField(i, { value: value.slice(0, start) + token + value.slice(end) })
    requestAnimationFrame(() => el?.focus())
  }
  const sendTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await api.workflowWebhookTest({ workflow, nodeId }))
    } catch (err) {
      setResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }
  return (
    <>
      <TextField label="URL" value={data.url} onChange={(url) => set({ url })} placeholder="https://…" hint="Recebe um POST em JSON. Erros temporários são tentados de novo após 15 s, 1 min e 5 min." />
      <div className="field">
        <span>Dados enviados</span>
        <div className="kv-table">
          {fields.map((f, i) => (
            <div className="kv-row" key={i}>
              <input value={f.key} onChange={(e) => setField(i, { key: e.target.value })} placeholder="chave" aria-label="Chave" />
              <input
                ref={(el) => (refs.current[i] = el)}
                value={f.value}
                onFocus={() => setActive(i)}
                onChange={(e) => setField(i, { value: e.target.value })}
                placeholder="valor ou {{variável}}"
                aria-label="Valor"
              />
              <button type="button" className="icon-btn" onClick={() => set({ fields: fields.filter((_, k) => k !== i) })} aria-label="Remover dado">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <VarChips names={vars} onPick={insert} />
        <div className="options-foot">
          <button type="button" className="btn small" disabled={fields.length >= LIMITS.webhookFields} onClick={() => set({ fields: [...fields, { key: '', value: '' }] })}>
            <Plus size={14} /> Adicionar dado
          </button>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={data.includeSheet} onChange={(e) => set({ includeSheet: e.target.checked })} />
        <span>
          Enviar também todas as colunas da planilha
          <small className="muted">Cada coluna vai com o prefixo planilha_.</small>
        </span>
      </label>
      <div className="wf-test">
        <button type="button" className="btn small" onClick={sendTest} disabled={testing || !/^https?:\/\//i.test(data.url || '')}>
          {testing ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />} Enviar teste
        </button>
        <small className="muted">Manda um exemplo com “teste”: true, para mapear os campos no CRM.</small>
      </div>
      {result && (
        <div className={`callout ${result.ok ? 'ok' : 'bad'} small`}>
          {result.ok ? `Recebido (HTTP ${result.status}).` : `Falhou: ${result.error || `HTTP ${result.status}`}${result.body ? ` — ${result.body}` : ''}`}
          {result.payload && <pre className="json-preview">{JSON.stringify(result.payload, null, 2)}</pre>}
        </div>
      )}
    </>
  )
}

export default function NodeInspector({ node, onChange, onDelete, vars, workflow }) {
  const { blockType: type, config } = node.data
  const set = (patch) => onChange({ ...config, ...patch })
  return (
    <div className="wf-inspector-body">
      <p className="muted small">{NODE_TYPES[type]?.hint}</p>
      <TextField label="Título do bloco (opcional)" value={config.title} onChange={(title) => set({ title })} maxLength={40} placeholder={NODE_TYPES[type]?.label} />

      {type === 'start' && (
        <>
          <div className="callout info small">O texto e a mídia desta mensagem são os da campanha. Aqui você define as opções e para onde cada uma leva.</div>
          <ChoicesEditor data={config} set={set} />
        </>
      )}
      {type === 'message' && <MessageFields data={config} set={set} vars={vars} />}
      {type === 'question' && <QuestionFields data={config} set={set} vars={vars} />}
      {type === 'data' && <DataFields data={config} set={set} vars={vars} />}
      {type === 'condition' && <ConditionFields data={config} set={set} />}
      {type === 'webhook' && <WebhookFields data={config} set={set} vars={vars} workflow={workflow} nodeId={node.id} />}

      {['start', 'message', 'question', 'data'].includes(type) && (type === 'question' || type === 'data' || config.choices?.length > 0) && (
        <TimeoutEditor timeout={config.timeout} set={set} />
      )}

      {type !== 'start' && (
        <button type="button" className="btn danger-ghost" onClick={onDelete}>
          <Trash2 size={16} /> Excluir bloco
        </button>
      )}
    </div>
  )
}
