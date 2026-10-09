import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../api.js'
import { formatDateTime, formatNumber } from '../utils.js'
import { CONTACT_STATUS, StatusBadge } from './StatusBadge.jsx'

const PAGE_SIZE = 50

export const FLOW_FILTERS = {
  qualified: 'Qualificados',
  confirmed: 'Dados confirmados',
  awaiting_data: 'Confirmando dados',
  webhook_failed: 'Falha no webhook',
  not_qualified: 'Não qualificados',
  interested: 'Com interesse',
  awaiting: 'Aguardando faturamento',
  no_interest: 'Sem interesse',
  no_reply: 'Sem resposta',
}

function FlowCell({ flow, fields }) {
  const f = flow || {}
  if (!f.interest) return <span className="muted">—</span>
  if (f.interest === 'no') return <span className="badge tone-muted">Sem interesse</span>
  if (f.revenueIndex == null) return <span className="badge tone-info">Interessado · aguardando</span>
  return (
    <div className="flow-cell">
      <span className={`badge ${f.qualified ? 'tone-ok' : 'tone-warn'}`} title={f.qualified ? 'Lead qualificado' : 'Não qualificado'}>
        {f.qualified ? '✓ ' : ''}
        {f.revenueLabel}
      </span>
      {f.dataConfirmed ? (
        <span className="flow-data" title={f.dataChanged ? 'O lead alterou os dados' : 'Dados confirmados'}>
          {fields.map((field, i) => f.data?.[i] && <span key={i}>{f.data[i]}</span>)}
          {f.dataChanged && <em>alterado</em>}
        </span>
      ) : (
        f.dataStarted && <span className="badge tone-info">Confirmando dados</span>
      )}
      {f.webhook?.status === 'sent' && <span className="badge tone-ok">Webhook ✓</span>}
      {f.webhook?.status === 'pending' && <span className="badge tone-info">Enviando ao webhook…</span>}
      {f.webhook?.status === 'failed' && (
        <span className="badge tone-bad" title={f.webhook.error || ''}>
          Webhook falhou
        </span>
      )}
    </div>
  )
}

/** `filter` usa o formato "status:sent" ou "flow:qualified". */
export default function ContactsTable({ id, version, hasFlow, hasWebhook = false, dataFields = [], filter, setFilter }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)

  const [kind, value] = filter ? filter.split(':') : ['', '']

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => setPage(1), [filter])

  useEffect(() => {
    let cancelled = false
    const params = { q: search, page, pageSize: PAGE_SIZE }
    if (kind === 'status') params.status = value
    if (kind === 'flow') params.flow = value
    api
      .contacts(id, params)
      .then((d) => !cancelled && setData(d))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, kind, value, search, page, version])

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const cols = hasFlow ? 6 : 5

  return (
    <>
      <div className="table-filters">
        <div className="input-icon">
          <Search size={16} />
          <input placeholder="Buscar número ou dado do CSV" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar contatos">
          <option value="">Todos os contatos</option>
          <optgroup label="Envio">
            {Object.entries(CONTACT_STATUS).map(([v, s]) => (
              <option key={v} value={`status:${v}`}>
                {s.label}
              </option>
            ))}
          </optgroup>
          {hasFlow && (
            <optgroup label="Respostas">
              {Object.entries(FLOW_FILTERS)
                .filter(([v]) => dataFields.length || !['confirmed', 'awaiting_data'].includes(v))
                .filter(([v]) => hasWebhook || v !== 'webhook_failed')
                .map(([v, label]) => (
                  <option key={v} value={`flow:${v}`}>
                    {label}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Linha</th>
              <th>Número</th>
              <th>Envio</th>
              {hasFlow && <th>Resposta</th>}
              <th>Mensagem / erro</th>
              <th>Horário</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((ct) => (
              <tr key={ct.i}>
                <td className="muted">{ct.i + 2}</td>
                <td className="nowrap mono">{ct.number || '—'}</td>
                <td>
                  <StatusBadge status={ct.status} map={CONTACT_STATUS} />
                </td>
                {hasFlow && (
                  <td className="nowrap">
                    <FlowCell flow={ct.flow} fields={dataFields} />
                  </td>
                )}
                <td className="cell-message" title={ct.error || ct.text || ''}>
                  {ct.error ? <span className="text-bad">{ct.error}</span> : ct.text || <span className="muted">—</span>}
                </td>
                <td className="nowrap muted">{ct.processedAt ? formatDateTime(ct.processedAt) : '—'}</td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr>
                <td colSpan={cols} className="muted center">
                  Nenhum contato encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="pagination">
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span className="muted small">
            Página {page} de {pages} · {formatNumber(data.total)} contatos
          </span>
          <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </div>
      )}
    </>
  )
}
