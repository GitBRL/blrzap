import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle, Mail, MessageCircle, Pause, Play, RefreshCw, Scale, Search, Smartphone, TriangleAlert } from 'lucide-react'
import { formatDateBR } from '@shared/dunning.js'
import { api } from '../../api.js'
import { formatDateTime, formatDuration, formatNumber, formatTime, formatWhen, localDateKey } from '../../utils.js'
import { CAMPAIGN_STATUS, ProgressBar } from '../StatusBadge.jsx'
import TituloDetalhe from './TituloDetalhe.jsx'

const PAGE_SIZE = 50
const STATUS = {
  pending: { label: 'Na fila', tone: 'info' },
  sent: { label: 'Enviado', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'bad' },
  skipped: { label: 'Não enviado', tone: 'muted' },
}
const CHANNEL = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  email: { label: 'E-mail', icon: Mail },
  internal: { label: 'E-mail interno', icon: Scale },
}

function useNow(enabled) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

/** Instância que está enviando a régua (do financeiro ou, sem ela, a das campanhas). */
export function InstanceStrip({ info }) {
  if (!info) return null
  const own = info.using === 'financeiro'
  const ok = info.connected
  return (
    <div className={`instance-strip ${!own ? 'warn' : ok ? 'ok' : 'bad'}`}>
      <Smartphone size={16} />
      <span>
        {own ? 'Enviando pela instância do financeiro' : 'Sem instância própria: usando a instância das campanhas'}
        {info.profileName || info.number ? ` · ${[info.profileName, info.number].filter(Boolean).join(' · ')}` : ''}
        {' · '}
        <strong>{ok ? 'conectada' : info.state === 'unconfigured' ? 'não configurada' : info.error || 'desconectada'}</strong>
        {!own && <span className="block small">Configure um número próprio em Configurações para a régua não dividir a fila com as campanhas.</span>}
      </span>
    </div>
  )
}

/** Acompanhamento dos envios da régua (WhatsApp e e-mail) por dia. */
export default function Envios({ active, version, onChanged }) {
  const [date, setDate] = useState(localDateKey(0))
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [instance, setInstance] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => setPage(1), [date, status, channel])

  const camp = data?.summary.campaign
  const live = Boolean(camp && ['running', 'queued', 'scheduled'].includes(camp.status)) || data?.summary.email.pending > 0
  const now = useNow(active && live)

  const load = useCallback(
    () =>
      api
        .envios({ date, status, channel, q: search, page, pageSize: PAGE_SIZE })
        .then(setData)
        .catch((err) => setNotice({ tone: 'bad', text: err.message })),
    [date, status, channel, search, page],
  )

  useEffect(() => {
    if (!active) return
    load()
    const t = setInterval(load, live ? 3000 : 15000)
    return () => clearInterval(t)
  }, [active, load, live, version, tick])

  useEffect(() => {
    if (!active) return
    const get = () => api.instanciaFinanceiro().then(setInstance).catch(() => {})
    get()
    const t = setInterval(get, 30_000)
    return () => clearInterval(t)
  }, [active, version])

  const act = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(action)
    setNotice(null)
    try {
      const r = await api.enviosAction(action, date)
      if (r.count !== undefined) setNotice({ tone: 'ok', text: `${r.count} ${r.count === 1 ? 'envio voltou' : 'envios voltaram'} para a fila.` })
      setTick((v) => v + 1)
      onChanged()
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message })
    } finally {
      setBusy('')
    }
  }

  const icon = (name, Icon) => (busy === name ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} />)
  const s = data?.summary
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const isToday = date === localDateKey(0)

  let progressText = ''
  if (camp?.status === 'running' && camp.nextSendAt) {
    const secs = Math.max(0, Math.round((camp.nextSendAt - now) / 1000))
    progressText = camp.pauseReason === 'batch' ? `Pausa entre lotes: retoma em ${formatDuration(secs)}` : `Próximo envio em ${secs}s`
  } else if (camp?.status === 'scheduled' && camp.scheduledFor) {
    progressText = `Fora da janela de envio: retoma ${formatWhen(camp.scheduledFor)}`
  } else if (camp?.status === 'queued') progressText = 'Aguardando a vez na fila desta instância'

  return (
    <>
      <section className="card">
        <div className="envios-head">
          <label className="field inline">
            <span>Dia</span>
            <input type="date" value={date} max={localDateKey(0)} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          {!isToday && (
            <button className="btn small" onClick={() => setDate(localDateKey(0))}>
              Hoje
            </button>
          )}
          <span className="spacer" />
          {camp && ['running', 'queued', 'scheduled'].includes(camp.status) && (
            <button className="btn" onClick={() => act('pausar')} disabled={!!busy}>
              {icon('pausar', Pause)} Pausar envios
            </button>
          )}
          {camp?.status === 'paused' && (
            <button className="btn primary" onClick={() => act('retomar')} disabled={!!busy}>
              {icon('retomar', Play)} Retomar envios
            </button>
          )}
          {s?.whatsapp.failed > 0 && !live && (
            <button className="btn" onClick={() => act('reenviar-whatsapp', `Reenviar as ${s.whatsapp.failed} mensagens de WhatsApp com falha?`)} disabled={!!busy}>
              {icon('reenviar-whatsapp', RefreshCw)} Reenviar falhas de WhatsApp
            </button>
          )}
          {s?.email.failed > 0 && (
            <button className="btn" onClick={() => act('reenviar-emails', 'Reenviar todos os e-mails da régua que falharam?')} disabled={!!busy}>
              {icon('reenviar-emails', RefreshCw)} Reenviar e-mails com falha
            </button>
          )}
        </div>

        <InstanceStrip info={instance} />

        {!data ? (
          <p className="muted">Carregando…</p>
        ) : (
          <>
            <div className="envios-summary">
              <div className="envios-block">
                <div className="envios-block-head">
                  <MessageCircle size={16} /> <strong>WhatsApp</strong>
                  {camp && <span className={`badge tone-${CAMPAIGN_STATUS[camp.status]?.tone || 'muted'}`}>{CAMPAIGN_STATUS[camp.status]?.label || camp.status}</span>}
                  <span className="spacer" />
                  <span className="muted small">{progressText}</span>
                </div>
                {camp ? (
                  <>
                    <ProgressBar counts={camp.counts} />
                    <div className="stat-row">
                      <span className="chip ok">{formatNumber(s.whatsapp.sent)} enviados</span>
                      {s.whatsapp.pending > 0 && <span className="chip info">{formatNumber(s.whatsapp.pending)} na fila</span>}
                      {s.whatsapp.failed > 0 && <span className="chip bad">{formatNumber(s.whatsapp.failed)} falhas</span>}
                      {s.whatsapp.skipped > 0 && <span className="chip muted-chip">{formatNumber(s.whatsapp.skipped)} não enviados</span>}
                    </div>
                  </>
                ) : (
                  <p className="muted small">Nenhuma mensagem de WhatsApp da régua {isToday ? 'hoje' : `em ${formatDateBR(date)}`}.</p>
                )}
              </div>
              <div className="envios-block">
                <div className="envios-block-head">
                  <Mail size={16} /> <strong>E-mail</strong>
                </div>
                {s.email.total ? (
                  <div className="stat-row">
                    <span className="chip ok">{formatNumber(s.email.sent)} enviados</span>
                    {s.email.pending > 0 && <span className="chip info">{formatNumber(s.email.pending)} na fila</span>}
                    {s.email.failed > 0 && <span className="chip bad">{formatNumber(s.email.failed)} falhas</span>}
                    {s.email.skipped > 0 && <span className="chip muted-chip">{formatNumber(s.email.skipped)} não enviados</span>}
                  </div>
                ) : (
                  <p className="muted small">Nenhum e-mail da régua {isToday ? 'hoje' : `em ${formatDateBR(date)}`}.</p>
                )}
                {s.tasksOpen > 0 && <p className="muted small">{s.tasksOpen} ligações pendentes: os envios dessas etapas saem depois do resultado.</p>}
              </div>
            </div>

            {camp?.lastError && (
              <div className="callout bad">
                <TriangleAlert size={16} /> {camp.lastError}
              </div>
            )}
            {notice && <div className={`callout ${notice.tone}`}>{notice.text}</div>}
          </>
        )}
      </section>

      <section className="card">
        <div className="table-filters">
          <div className="input-icon">
            <Search size={16} />
            <input placeholder="Buscar cliente, telefone, e-mail ou etapa" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal">
            <option value="">Todos os canais</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
            <option value="">Todas as situações</option>
            <option value="failed">Falhas</option>
            <option value="pending">Na fila</option>
            <option value="sent">Enviados</option>
            <option value="skipped">Não enviados</option>
          </select>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Horário</th>
                <th>Cliente</th>
                <th>Etapa</th>
                <th>Canal</th>
                <th>Situação</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((i) => {
                const C = CHANNEL[i.channel]
                const st = STATUS[i.status] || { label: i.status, tone: 'muted' }
                return (
                  <tr key={i.id} className={i.titleId ? 'clickable-row' : ''} onClick={() => i.titleId && setDetailId(i.titleId)}>
                    <td className="nowrap muted">{i.at ? formatTime(i.at).slice(0, 5) : '—'}</td>
                    <td>
                      <strong>{i.nome || '—'}</strong>
                      <span className="muted small block">{i.to}</span>
                    </td>
                    <td className="nowrap">
                      {i.stage && <strong>{i.stage} </strong>}
                      {i.what}
                    </td>
                    <td className="nowrap">
                      <span className="channel-cell">
                        <C.icon size={14} /> {C.label}
                      </span>
                    </td>
                    <td>
                      <span className={`badge tone-${st.tone}`}>{st.label}</span>
                    </td>
                    <td className="cell-message" title={i.error || i.text || ''}>
                      {i.error ? (
                        <span className={i.status === 'failed' ? 'text-bad' : 'muted'}>{i.error}</span>
                      ) : (
                        i.text || <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {data && !data.items.length && (
                <tr>
                  <td colSpan={6} className="muted center">
                    Nenhum envio encontrado.
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
              Página {page} de {pages} · {formatNumber(data.total)} envios
            </span>
            <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Próxima
            </button>
          </div>
        )}
      </section>

      {data?.summary.runs.length > 0 && (
        <section className="card">
          <h3 className="card-title">Execuções da régua</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Tipo</th>
                  <th>Etapas</th>
                  <th>WhatsApp</th>
                  <th>E-mails</th>
                  <th>Ligações</th>
                  <th>Puladas</th>
                  <th>Promessas não cumpridas</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.runs.map((r) => (
                  <tr key={r.at} className="clickable-row" onClick={() => setDate(r.date)}>
                    <td className="nowrap">{formatDateTime(r.at)}</td>
                    <td>{r.manual ? 'Manual' : 'Automática'}</td>
                    <td>{formatNumber(r.executed)}</td>
                    <td>{formatNumber(r.whatsapp)}</td>
                    <td>{formatNumber(r.email + r.internal)}</td>
                    <td>{formatNumber(r.calls)}</td>
                    <td>{formatNumber(r.skipped)}</td>
                    <td>{formatNumber(r.broken)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Clique numa execução para ver os envios daquele dia.</p>
        </section>
      )}

      {detailId && <TituloDetalhe id={detailId} onClose={() => setDetailId(null)} onChanged={onChanged} />}
    </>
  )
}
