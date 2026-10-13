import { useEffect, useState } from 'react'
import { Download, Search, Upload } from 'lucide-react'
import { formatDateBR, formatMoney } from '@shared/dunning.js'
import { api } from '../../api.js'
import { formatNumber } from '../../utils.js'
import ImportTitulos from './ImportTitulos.jsx'
import TituloDetalhe from './TituloDetalhe.jsx'

const PAGE_SIZE = 50

export const TITLE_FILTERS = {
  open: 'Em aberto',
  upcoming: 'A vencer',
  today: 'Vencem hoje',
  overdue: 'Vencidos',
  promise: 'Com promessa',
  paused: 'Régua pausada',
  paid: 'Pagos',
  cancelled: 'Cancelados',
  '': 'Todos',
}

export const STEP_STATUS = {
  done: { label: 'concluída', tone: 'ok' },
  sending: { label: 'enviando', tone: 'info' },
  waiting_call: { label: 'aguardando ligação', tone: 'warn' },
  partial: { label: 'parcial', tone: 'warn' },
  failed: { label: 'falhou', tone: 'bad' },
  skipped: { label: 'pulada', tone: 'muted' },
}

/** "D+5" com cor: verde antes do vencimento, amarelo no dia, vermelho em atraso. */
export function DayBadge({ diff }) {
  const label = diff === 0 ? 'D0' : diff > 0 ? `D+${diff}` : `D${diff}`
  const tone = diff > 0 ? 'bad' : diff === 0 ? 'warn' : 'ok'
  return <span className={`badge tone-${tone} day-badge`}>{label}</span>
}

export function TitleStatus({ t }) {
  if (t.status === 'paid') return <span className="badge tone-ok">Pago</span>
  if (t.status === 'cancelled') return <span className="badge tone-muted">Cancelado</span>
  return (
    <span className="badges">
      <span className="badge tone-info">Em aberto</span>
      {t.paused && <span className="badge tone-warn">Régua pausada</span>}
      {t.promise?.status === 'active' && <span className="badge tone-info">Promessa {formatDateBR(t.promise.date)}</span>}
      {t.promise?.status === 'broken' && <span className="badge tone-bad">Promessa não cumprida</span>}
    </span>
  )
}

export default function Titulos({ active, filter, setFilter, version, onChanged }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [importing, setImporting] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [localVersion, setLocalVersion] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => setPage(1), [filter])

  useEffect(() => {
    if (!active) return
    let alive = true
    api
      .titulos({ status: filter, q: search, page, pageSize: PAGE_SIZE })
      .then((d) => alive && setData(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [active, filter, search, page, version, localVersion])

  const reload = () => {
    setLocalVersion((v) => v + 1)
    onChanged()
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const emptyBase = data && data.total === 0 && !search && (filter === '' || filter === 'open')

  return (
    <section className="card">
      <div className="table-filters">
        <div className="input-icon">
          <Search size={16} />
          <input placeholder="Buscar cliente, telefone, e-mail ou nº do título" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar títulos">
          {Object.entries(TITLE_FILTERS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => setImporting(true)}>
          <Upload size={16} /> Importar títulos
        </button>
      </div>

      {emptyBase ? (
        <div className="empty-state compact">
          <h2>Nenhum título na régua</h2>
          <p className="muted">
            Importe um CSV com os títulos a receber: cliente, telefone, e-mail, vencimento, valor e links do boleto e de pagamento.
            Reimportar a planilha atualiza os títulos e dá baixa nos pagos.
          </p>
          <div className="actions">
            <button className="btn primary" onClick={() => setImporting(true)}>
              <Upload size={16} /> Importar títulos
            </button>
            <a className="btn" href="/exemplo-titulos.csv" download>
              <Download size={16} /> CSV de exemplo
            </a>
          </div>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table titles-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Etapa atual</th>
                  <th>Próxima etapa</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.id} className="clickable-row" onClick={() => setDetailId(t.id)}>
                    <td>
                      <strong>{t.nome}</strong>
                      <span className="muted small block">
                        {t.numero && `Nº ${t.numero} · `}
                        {t.telefone}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoney(t.valor)}</td>
                    <td className="nowrap">
                      {formatDateBR(t.vencimento)} {t.status === 'open' && <DayBadge diff={t.diff} />}
                    </td>
                    <td>
                      {t.current ? (
                        <>
                          <strong>{t.current.label}</strong> {t.current.name}
                          <span className={`small block text-${STEP_STATUS[t.current.status]?.tone || 'muted'}`}>
                            {STEP_STATUS[t.current.status]?.label || t.current.status}
                          </span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {t.next ? (
                        <>
                          <strong>{t.next.label}</strong> {t.next.name}
                          <span className="muted small block">{formatDateBR(t.next.date)}</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <TitleStatus t={t} />
                    </td>
                  </tr>
                ))}
                {data && !data.items.length && (
                  <tr>
                    <td colSpan={6} className="muted center">
                      Nenhum título encontrado.
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
                Página {page} de {pages} · {formatNumber(data.total)} títulos
              </span>
              <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Próxima
              </button>
            </div>
          )}
        </>
      )}

      {importing && (
        <ImportTitulos
          onClose={() => setImporting(false)}
          onDone={() => {
            reload()
          }}
        />
      )}
      {detailId && <TituloDetalhe id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </section>
  )
}
