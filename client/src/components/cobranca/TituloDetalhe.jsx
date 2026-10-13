import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, CirclePause, HandCoins, LoaderCircle, Mail, MessageCircle, Phone, Play, RotateCcw, Scale, Trash2, X } from 'lucide-react'
import { CALL_RESULTS, formatDateBR, formatMoney } from '@shared/dunning.js'
import { api } from '../../api.js'
import { formatDateTime, localDateKey } from '../../utils.js'
import { DayBadge, STEP_STATUS, TitleStatus } from './Titulos.jsx'

const CHANNELS = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  email: { label: 'E-mail', icon: Mail },
  internal: { label: 'E-mail interno', icon: Scale },
}
const CHANNEL_STATUS = { sent: 'enviado', pending: 'na fila', failed: 'falhou', skipped: 'não enviado' }

function Channels({ step }) {
  const list = Object.entries(step.channels || {})
  return (
    <span className="channel-chips">
      {step.call && (
        <span className="chip-mini" title={step.call.note || ''}>
          <Phone size={12} /> {CALL_RESULTS[step.call.result] || step.call.result}
        </span>
      )}
      {list.map(([key, ch]) => {
        const C = CHANNELS[key]
        return (
          <span key={key} className={`chip-mini tone-${ch.status === 'sent' ? 'ok' : ch.status === 'failed' ? 'bad' : 'muted'}`} title={ch.error || ''}>
            <C.icon size={12} /> {C.label}: {CHANNEL_STATUS[ch.status] || ch.status}
            {ch.error && ch.status !== 'sent' ? ` (${ch.error})` : ''}
          </span>
        )
      })}
    </span>
  )
}

export default function TituloDetalhe({ id, onClose, onChanged }) {
  const [t, setT] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [promiseDate, setPromiseDate] = useState(localDateKey(3))
  const [showPromise, setShowPromise] = useState(false)

  const load = useCallback(() => api.titulo(id).then(setT).catch((err) => setError(err.message)), [id])
  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = async (action, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(action)
    setError('')
    try {
      await api.tituloAction(id, action, body)
      onChanged()
      if (action === 'excluir') return onClose()
      setShowPromise(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const icon = (name, Icon) => (busy === name ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} />)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true">
        {!t ? (
          <p className="muted">{error || 'Carregando…'}</p>
        ) : (
          <>
            <div className="modal-head">
              <div>
                <h2>{t.nome}</h2>
                <span className="muted small">
                  {t.numero && `Título ${t.numero} · `}
                  {formatMoney(t.valor)} · vence em {formatDateBR(t.vencimento)} {t.status === 'open' && <DayBadge diff={t.diff} />}
                </span>
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            <div className="detail-contact">
              <TitleStatus t={t} />
              <a href={`https://wa.me/${t.telefone}`} target="_blank" rel="noreferrer" className="link small">
                <MessageCircle size={14} /> {t.telefone}
              </a>
              {t.email && (
                <a href={`mailto:${t.email}`} className="link small">
                  <Mail size={14} /> {t.email}
                </a>
              )}
              {t.boleto && (
                <a href={t.boleto} target="_blank" rel="noreferrer" className="link small">
                  Boleto
                </a>
              )}
              {t.pagamento && (
                <a href={t.pagamento} target="_blank" rel="noreferrer" className="link small">
                  Link de pagamento
                </a>
              )}
            </div>

            <div className="actions">
              {t.status === 'open' && (
                <>
                  <button className="btn primary" onClick={() => act('pago', {}, 'Marcar este título como pago? A régua para e os envios na fila são cancelados.')} disabled={!!busy}>
                    {icon('pago', CircleCheck)} Marcar como pago
                  </button>
                  <button className="btn" onClick={() => setShowPromise((v) => !v)} disabled={!!busy}>
                    <HandCoins size={16} /> Promessa de pagamento
                  </button>
                  {t.paused ? (
                    <button className="btn" onClick={() => act('retomar')} disabled={!!busy}>
                      {icon('retomar', Play)} Retomar régua
                    </button>
                  ) : (
                    <button className="btn" onClick={() => act('pausar')} disabled={!!busy}>
                      {icon('pausar', CirclePause)} Pausar régua
                    </button>
                  )}
                </>
              )}
              {t.status !== 'open' && (
                <button className="btn" onClick={() => act('reabrir', {}, 'Reabrir o título? A régua continua a partir da etapa do dia.')} disabled={!!busy}>
                  {icon('reabrir', RotateCcw)} Reabrir
                </button>
              )}
              <span className="spacer" />
              {t.status === 'open' && (
                <button className="btn danger-ghost" onClick={() => act('cancelar', {}, 'Cancelar o título? Ele sai da régua.')} disabled={!!busy}>
                  {icon('cancelar', X)} Cancelar título
                </button>
              )}
              <button className="btn danger-ghost" onClick={() => act('excluir', {}, 'Excluir o título e o histórico dele?')} disabled={!!busy} title="Excluir">
                {icon('excluir', Trash2)}
              </button>
            </div>

            {showPromise && (
              <div className="reschedule">
                <span className="small">O cliente prometeu pagar em</span>
                <input type="date" value={promiseDate} min={localDateKey(0)} onChange={(e) => setPromiseDate(e.target.value)} />
                <button className="btn primary" onClick={() => act('promessa', { date: promiseDate })} disabled={!!busy || !promiseDate}>
                  {icon('promessa', HandCoins)} Registrar
                </button>
                <span className="muted small">A régua fica suspensa até essa data.</span>
              </div>
            )}
            {error && <div className="callout bad">{error}</div>}

            <h3 className="subhead">Régua</h3>
            <ol className="timeline">
              {t.timeline.map((s) => {
                const st = s.step ? STEP_STATUS[s.step.status] : null
                return (
                  <li key={s.key} className={`${s.step ? 'has-step' : ''} ${!s.enabled ? 'disabled' : ''}`}>
                    <span className={`timeline-dot tone-${st?.tone || 'muted'}`} />
                    <div>
                      <div className="timeline-head">
                        <strong>{s.label}</strong> {s.name}
                        <span className="muted small"> · {formatDateBR(s.date)}</span>
                        {st && <span className={`badge tone-${st.tone}`}>{st.label}</span>}
                        {!s.enabled && <span className="badge tone-muted">desativada</span>}
                      </div>
                      {s.step?.note && <span className="muted small">{s.step.note}</span>}
                      {s.step && <Channels step={s.step} />}
                    </div>
                  </li>
                )
              })}
            </ol>

            <h3 className="subhead">Histórico</h3>
            <ul className="log">
              {t.history.map((h, i) => (
                <li key={`${h.at}-${i}`} className={`log-${h.level}`}>
                  <span className="log-time">{formatDateTime(h.at)}</span>
                  <span>{h.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
