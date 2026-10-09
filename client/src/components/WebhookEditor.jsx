import { useRef, useState } from 'react'
import { LoaderCircle, Plus, Send, Trash2 } from 'lucide-react'
import { buildLeadPayload, prefillValue, SYSTEM_VARIABLES } from '@shared/datafields.js'
import { api } from '../api.js'

function VariableGroup({ title, names, onPick }) {
  if (!names.length) return null
  return (
    <div className="var-chips">
      <span className="muted small">{title}:</span>
      {names.map((n) => (
        <button key={n} type="button" className="var-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(n)}>
          {`{{${n}}}`}
        </button>
      ))}
    </div>
  )
}

/** URL + tabela de dados (chave → valor com variáveis) enviada para cada lead qualificado. */
export default function WebhookEditor({ webhook, setWebhook, dataFields, headers, sample }) {
  const valueRefs = useRef([])
  const [active, setActive] = useState(0)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)

  const set = (patch) => setWebhook({ ...webhook, ...patch })
  const setField = (i, patch) => set({ fields: webhook.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) })

  /** Insere a variável no cursor do último campo de valor focado. */
  const insertVariable = (name) => {
    const i = Math.min(active, webhook.fields.length - 1)
    if (i < 0) return
    const el = valueRefs.current[i]
    const token = `{{${name}}}`
    const value = webhook.fields[i].value
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    setField(i, { value: value.slice(0, start) + token + value.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const sampleValues = dataFields.map((f) => (sample.number ? prefillValue(f, sample.vars, sample.number) : '') || `[${f.label}]`)
  const example = buildLeadPayload({
    webhook,
    fields: dataFields,
    values: sampleValues,
    vars: sample.vars,
    number: sample.number || '5511999998888',
    revenue: 'Acima de R$ 80 mil',
    campaign: 'Nome da campanha',
  })

  const sendTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await api.webhookTest({ webhook, dataFields, vars: sample.vars }))
    } catch (err) {
      setResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="webhook-editor">
      <label className="field">
        <span>URL do webhook (opcional)</span>
        <input
          type="url"
          value={webhook.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="https://… (ex.: webhook de entrada do Clint)"
        />
        <small className="muted">
          Quando um lead qualificado confirmar os dados, enviamos um POST com JSON para esta URL. Falhas temporárias são
          tentadas de novo automaticamente.
        </small>
      </label>

      {webhook.url.trim() && (
        <>
          <div className="field">
            <span>Dados enviados</span>
            <div className="kv-table">
              <div className="kv-head muted small">
                <span>Chave</span>
                <span>Valor (texto fixo ou variáveis)</span>
                <span />
              </div>
              {webhook.fields.map((f, i) => (
                <div className="kv-row" key={i}>
                  <input
                    value={f.key}
                    onChange={(e) => setField(i, { key: e.target.value })}
                    placeholder="chave"
                    className="mono"
                    aria-label="Chave"
                  />
                  <input
                    ref={(el) => (valueRefs.current[i] = el)}
                    value={f.value}
                    onFocus={() => setActive(i)}
                    onChange={(e) => setField(i, { value: e.target.value })}
                    placeholder="Ex.: {{Nome}}"
                    aria-label="Valor"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => set({ fields: webhook.fields.filter((_, k) => k !== i) })}
                    aria-label="Remover dado"
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
                disabled={webhook.fields.length >= 40}
                onClick={() => {
                  set({ fields: [...webhook.fields, { key: '', value: '' }] })
                  setActive(webhook.fields.length)
                }}
              >
                <Plus size={14} /> Adicionar dado
              </button>
            </div>
          </div>

          <div className="variables">
            <span className="small">Clique para inserir no valor selecionado:</span>
            <VariableGroup title="Dados confirmados" names={dataFields.map((f) => f.label).filter(Boolean)} onPick={insertVariable} />
            <VariableGroup title="Fluxo" names={SYSTEM_VARIABLES.map((v) => v.name)} onPick={insertVariable} />
            <VariableGroup title="Planilha" names={headers} onPick={insertVariable} />
          </div>

          <label className="check">
            <input type="checkbox" checked={webhook.includeSheet} onChange={(e) => set({ includeSheet: e.target.checked })} />
            <span>
              Enviar também todas as colunas do CSV
              <small className="muted">Cada coluna vai como planilha_nome_da_coluna.</small>
            </span>
          </label>

          <details className="help">
            <summary>Exemplo do JSON enviado</summary>
            <pre className="json-preview">{JSON.stringify(example, null, 2)}</pre>
          </details>

          <div className="webhook-test">
            <button type="button" className="btn" onClick={sendTest} disabled={testing}>
              {testing ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Enviar lead de teste
            </button>
            <small className="muted">Use para mapear os campos no CRM antes do disparo. O JSON vai com "teste": true.</small>
          </div>
          {result && (
            <div className={`callout ${result.ok ? 'ok' : 'bad'}`}>
              {result.ok
                ? `Webhook respondeu HTTP ${result.status}. Confira o lead de teste no CRM.`
                : `Falhou: ${result.error || `HTTP ${result.status}`}${result.body ? ` — ${result.body.slice(0, 200)}` : ''}`}
            </div>
          )}
        </>
      )}
    </div>
  )
}
