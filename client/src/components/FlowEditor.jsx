import { Plus, Trash2 } from 'lucide-react'
import { DEFAULT_DATA_STEP, DEFAULT_WEBHOOK, FIELD_TYPES, WHATSAPP_COLUMN } from '@shared/datafields.js'
import WebhookEditor from './WebhookEditor.jsx'

export const DEFAULT_FLOW = {
  enabled: false,
  buttons: { yes: 'Tenho interesse', no: 'Não tenho interesse' },
  footer: '',
  question: 'Que ótimo! Para indicarmos a melhor solução para você, qual é o faturamento mensal da sua empresa?',
  listButton: 'Ver faixas',
  options: [
    { label: 'Até R$ 20 mil', qualified: false },
    { label: 'R$ 20 mil a R$ 50 mil', qualified: false },
    { label: 'R$ 50 mil a R$ 80 mil', qualified: false },
    { label: 'Acima de R$ 80 mil', qualified: true },
  ],
  dataStep: DEFAULT_DATA_STEP,
  webhook: DEFAULT_WEBHOOK,
  replies: {
    qualified: 'Obrigado, {{Nome}}! Seus dados foram confirmados. Um dos nossos especialistas vai entrar em contato com você em breve. 🚀',
    notQualified:
      'Muito obrigado pelo interesse e pelas informações! 🙏\n\n' +
      'Com base no que você compartilhou, infelizmente não seguiremos com uma proposta neste momento: nossa solução hoje é voltada para empresas em outro estágio de faturamento.\n\n' +
      'Vamos manter seu contato e, se surgir uma opção adequada ao momento da sua empresa, retornaremos. Desejamos muito sucesso!',
    noInterest: 'Tudo bem, obrigado pelo retorno! 🙂',
  },
}

/** Problemas que impedem salvar o fluxo (mesmas regras do servidor). */
export function flowProblems(flow) {
  if (!flow.enabled) return []
  const out = []
  if (!flow.buttons.yes.trim() || !flow.buttons.no.trim()) out.push('Preencha o texto dos dois botões.')
  if (!flow.question.trim()) out.push('Escreva a pergunta de faturamento.')
  if (flow.options.filter((o) => o.label.trim()).length < 2) out.push('Informe pelo menos 2 faixas de faturamento.')
  const ds = flow.dataStep
  if (ds?.enabled) {
    const fields = ds.fields.filter((f) => f.label.trim())
    if (!fields.length) out.push('Adicione pelo menos um campo na confirmação de dados.')
    if (fields.some((f) => !f.question.trim())) out.push('Escreva a pergunta de cada campo da confirmação de dados.')
    if (!ds.confirmLabel.trim() || !ds.editLabel.trim()) out.push('Preencha os botões de confirmação de dados.')
  }
  const url = flow.webhook?.url?.trim()
  if (url) {
    if (!/^https?:\/\/[^\s/]+/i.test(url)) out.push('URL do webhook inválida (use http:// ou https://).')
    else if (!flow.webhook.fields.some((f) => f.key.trim()) && !flow.webhook.includeSheet) out.push('Adicione pelo menos um dado para o webhook.')
  }
  return out
}

/** Campos que o lead qualificado confirma (com a coluna do CSV de onde vem cada valor). */
function DataStepEditor({ dataStep: ds, setDataStep, headers }) {
  const set = (patch) => setDataStep({ ...ds, ...patch })
  const setField = (i, patch) => set({ fields: ds.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) })

  return (
    <div className="data-step">
      <label className="check">
        <input type="checkbox" checked={ds.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          Pedir para o lead qualificado confirmar os dados
          <small className="muted">
            Ele recebe os dados com os botões “{ds.confirmLabel || 'Confirmar'}” e “{ds.editLabel || 'Alterar'}”. A mensagem final
            só sai depois da confirmação.
          </small>
        </span>
      </label>

      {ds.enabled && (
        <>
          <label className="field">
            <span>Mensagem de confirmação</span>
            <textarea rows={2} value={ds.intro} onChange={(e) => set({ intro: e.target.value })} />
            <small className="muted">Os dados aparecem logo abaixo deste texto, um por linha.</small>
          </label>

          <div className="field">
            <span>Dados</span>
            <div className="data-fields">
              {ds.fields.map((f, i) => {
                const columnKnown = !f.column || f.column === WHATSAPP_COLUMN || headers.includes(f.column)
                return (
                  <div className="data-field" key={i}>
                    <div className="data-field-row">
                      <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} maxLength={30} placeholder="Nome do campo" aria-label="Nome do campo" />
                      <select value={f.column} onChange={(e) => setField(i, { column: e.target.value })} aria-label="Coluna do CSV">
                        <option value="">Sem coluna (perguntar)</option>
                        <option value={WHATSAPP_COLUMN}>Número do WhatsApp</option>
                        {!columnKnown && <option value={f.column}>{f.column} (não está no CSV)</option>}
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            Coluna: {h}
                          </option>
                        ))}
                      </select>
                      <select value={f.type} onChange={(e) => setField(i, { type: e.target.value })} aria-label="Tipo">
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={ds.fields.length <= 1}
                        onClick={() => set({ fields: ds.fields.filter((_, k) => k !== i) })}
                        aria-label="Remover campo"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <input
                      value={f.question}
                      onChange={(e) => setField(i, { question: e.target.value })}
                      placeholder="Pergunta usada quando o dado faltar ou o lead pedir para alterar"
                      aria-label="Pergunta"
                    />
                  </div>
                )
              })}
            </div>
            <div className="options-foot">
              <button
                type="button"
                className="btn small"
                disabled={ds.fields.length >= 8}
                onClick={() => set({ fields: [...ds.fields, { label: '', column: '', type: 'text', question: '' }] })}
              >
                <Plus size={14} /> Adicionar campo
              </button>
              <small className="muted">Campos vazios no CSV são perguntados antes de mostrar o resumo. E-mail e telefone são validados.</small>
            </div>
          </div>

          <div className="grid-2">
            <TextField label="Botão de confirmar" value={ds.confirmLabel} onChange={(confirmLabel) => set({ confirmLabel })} maxLength={20} />
            <TextField label="Botão de alterar" value={ds.editLabel} onChange={(editLabel) => set({ editLabel })} maxLength={20} />
          </div>

          <details className="help">
            <summary>Textos da coleta de dados</summary>
            <div className="flow-editor nested">
              <TextField
                label="Antes de perguntar dados que faltam no CSV"
                value={ds.collectIntro}
                onChange={(collectIntro) => set({ collectIntro })}
              />
              <TextField label="Quando o lead toca em alterar" value={ds.editIntro} onChange={(editIntro) => set({ editIntro })} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function TextField({ label, value, onChange, maxLength, placeholder, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={placeholder} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

function ReplyField({ label, value, onChange, hint, rows = 2 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Deixe vazio para não enviar" />
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export default function FlowEditor({ flow, setFlow, headers = [], sample = { vars: {}, number: '' } }) {
  const set = (patch) => setFlow({ ...flow, ...patch })
  const setButtons = (patch) => set({ buttons: { ...flow.buttons, ...patch } })
  const setReplies = (patch) => set({ replies: { ...flow.replies, ...patch } })
  const setOption = (i, patch) => set({ options: flow.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) })
  const usesList = flow.options.length > 3
  const qualifiedCount = flow.options.filter((o) => o.qualified && o.label.trim()).length

  return (
    <div className="flow-editor">
      <div className="grid-2">
        <TextField label="Botão 1" value={flow.buttons.yes} onChange={(yes) => setButtons({ yes })} maxLength={20} />
        <TextField label="Botão 2" value={flow.buttons.no} onChange={(no) => setButtons({ no })} maxLength={20} />
      </div>
      <TextField
        label="Rodapé (opcional)"
        value={flow.footer}
        onChange={(footer) => set({ footer })}
        maxLength={60}
        placeholder="Ex.: Toque em uma das opções abaixo"
      />

      <h3 className="subhead">Quem tocar em “{flow.buttons.yes || 'Botão 1'}” recebe</h3>
      <label className="field">
        <span>Pergunta de faturamento</span>
        <textarea rows={3} value={flow.question} onChange={(e) => set({ question: e.target.value })} />
        <small className="muted">Aceita as mesmas variáveis da mensagem, como {'{{nome}}'}.</small>
      </label>

      <div className="field">
        <span>Faixas de faturamento</span>
        <div className="options-list">
          {flow.options.map((o, i) => (
            <div className="option-row" key={i}>
              <span className="option-num">{i + 1}</span>
              <input value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} maxLength={24} placeholder="Ex.: Acima de R$ 80 mil" />
              <label className={`qualify-toggle ${o.qualified ? 'on' : ''}`}>
                <input type="checkbox" checked={o.qualified} onChange={(e) => setOption(i, { qualified: e.target.checked })} />
                Qualificado
              </label>
              <button
                type="button"
                className="icon-btn"
                disabled={flow.options.length <= 2}
                onClick={() => set({ options: flow.options.filter((_, k) => k !== i) })}
                aria-label="Remover faixa"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="options-foot">
          <button
            type="button"
            className="btn small"
            disabled={flow.options.length >= 10}
            onClick={() => set({ options: [...flow.options, { label: '', qualified: true }] })}
          >
            <Plus size={14} /> Adicionar faixa
          </button>
          <small className="muted">
            {qualifiedCount
              ? `${qualifiedCount} ${qualifiedCount === 1 ? 'faixa conta' : 'faixas contam'} como lead qualificado.`
              : 'Nenhuma faixa marcada como qualificada.'}{' '}
            O contato também pode responder digitando o número da faixa. Vale a primeira faixa informada.
          </small>
        </div>
      </div>

      {usesList && (
        <TextField
          label="Texto do botão que abre a lista"
          value={flow.listButton}
          onChange={(listButton) => set({ listButton })}
          maxLength={20}
          hint="Com mais de 3 faixas, as opções aparecem em uma lista."
        />
      )}

      <h3 className="subhead">Confirmação de dados</h3>
      <DataStepEditor dataStep={flow.dataStep} setDataStep={(dataStep) => set({ dataStep })} headers={headers} />

      <h3 className="subhead">Enviar leads qualificados para um webhook (ex.: Clint)</h3>
      <WebhookEditor
        webhook={flow.webhook}
        setWebhook={(webhook) => set({ webhook })}
        dataFields={flow.dataStep.enabled ? flow.dataStep.fields : []}
        headers={headers}
        sample={sample}
      />

      <h3 className="subhead">Respostas automáticas</h3>
      <ReplyField
        label={flow.dataStep.enabled ? 'Mensagem final (após confirmar os dados)' : 'Para leads qualificados'}
        value={flow.replies.qualified}
        onChange={(qualified) => setReplies({ qualified })}
        hint={flow.dataStep.enabled ? 'Pode usar os dados confirmados, como {{Nome}} ou {{E-mail}}.' : undefined}
      />
      <ReplyField
        label="Para não qualificados"
        value={flow.replies.notQualified}
        onChange={(notQualified) => setReplies({ notQualified })}
        rows={5}
        hint="Enviada para quem escolher uma faixa não marcada como “Qualificado”."
      />
      <ReplyField
        label={`Para quem tocar em “${flow.buttons.no || 'Botão 2'}”`}
        value={flow.replies.noInterest}
        onChange={(noInterest) => setReplies({ noInterest })}
      />
    </div>
  )
}
