import { useEffect, useState } from 'react'
import { Download, Radio, RefreshCw, Send, Users } from 'lucide-react'
import { api } from '../api.js'
import { formatNumber, formatTime } from '../utils.js'

function FunnelRow({ label, value, base, tone, onClick }) {
  const pct = base ? Math.round((value / base) * 100) : 0
  return (
    <button type="button" className="funnel-row" onClick={onClick} disabled={!onClick}>
      <span className="funnel-label">{label}</span>
      <span className="funnel-bar">
        <span className={`funnel-fill tone-${tone}`} style={{ width: `${base ? Math.max((value / base) * 100, value ? 2 : 0) : 0}%` }} />
      </span>
      <span className="funnel-value">
        <strong>{formatNumber(value)}</strong> <span className="muted small">{pct}%</span>
      </span>
    </button>
  )
}

/** Estado do recebimento de respostas (consultado a cada 5 s enquanto `enabled`). */
export function useResponses(enabled = true) {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      api
        .responses()
        .then((s) => alive && setStatus(s))
        .catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [enabled])
  return status
}

/** Situação da conexão que recebe os cliques dos contatos. */
export function ListenerStatus({ status }) {
  if (!status) return null
  const { sse, webhook } = status
  const webhookRecent = webhook.lastEventAt && Date.now() - webhook.lastEventAt < 24 * 3600_000
  const ok = sse.connected || webhookRecent
  return (
    <div className={`listener ${ok ? 'ok' : 'bad'}`}>
      <Radio size={15} />
      <span>
        {sse.connected
          ? 'Recebendo respostas em tempo real'
          : webhookRecent
            ? 'Recebendo respostas pelo webhook'
            : sse.lastError || 'Recebimento de respostas desligado'}
        {(sse.lastEventAt || webhook.lastEventAt) && (
          <span className="muted"> · último evento às {formatTime(Math.max(sse.lastEventAt || 0, webhook.lastEventAt || 0))}</span>
        )}
      </span>
    </div>
  )
}

export function RecentReplies({ recent = [] }) {
  if (!recent.length) return null
  return (
    <details className="help">
      <summary>Últimas respostas recebidas (todas as campanhas)</summary>
      <ul className="log">
        {recent.map((r, i) => (
          <li key={`${r.at}-${i}`} className={r.matched ? 'log-success' : 'log-warn'}>
            <span className="log-time">{formatTime(r.at)}</span>
            <span>
              +{r.from} — “{r.text}” → {r.note}
              {r.campaign && <span className="muted"> ({r.campaign})</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function WebhookStatus({ campaign, fc, onShow, onRetry }) {
  const [busy, setBusy] = useState(false)
  if (!campaign.flow.webhook) return null
  let host = ''
  try {
    host = new URL(campaign.flow.webhook.url).host
  } catch {
    host = campaign.flow.webhook.url
  }
  const retry = async () => {
    setBusy(true)
    try {
      await onRetry()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`webhook-status ${fc.webhookFailed ? 'bad' : 'ok'}`}>
      <Send size={15} />
      <span>
        Webhook <strong>{host}</strong>: {formatNumber(fc.webhookSent)} {fc.webhookSent === 1 ? 'lead enviado' : 'leads enviados'}
        {fc.webhookPending > 0 && ` · ${formatNumber(fc.webhookPending)} enviando`}
        {fc.webhookFailed > 0 && (
          <>
            {' · '}
            <button type="button" className="link-btn" onClick={() => onShow('flow:webhook_failed')}>
              {formatNumber(fc.webhookFailed)} com falha
            </button>
          </>
        )}
      </span>
      {fc.webhookFailed > 0 && (
        <button type="button" className="btn small" onClick={retry} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} /> Reenviar falhas
        </button>
      )}
    </div>
  )
}

export default function FlowResults({ campaign, onShow, onRetryWebhooks }) {
  const { flow, flowCounts: fc, counts } = campaign
  const maxOption = Math.max(1, ...fc.byOption)
  const responses = useResponses()

  return (
    <div className="flow-results">
      <ListenerStatus status={responses} />
      <WebhookStatus campaign={campaign} fc={fc} onShow={onShow} onRetry={onRetryWebhooks} />

      <div className="funnel">
        <FunnelRow label="Mensagens enviadas" value={counts.sent} base={counts.sent} tone="info" onClick={() => onShow('status:sent')} />
        <FunnelRow label={`Tocaram em “${flow.buttons.yes}”`} value={fc.interested} base={counts.sent} tone="info" onClick={() => onShow('flow:interested')} />
        <FunnelRow label="Informaram o faturamento" value={fc.answered} base={counts.sent} tone="info" />
        <FunnelRow label="Leads qualificados" value={fc.qualified} base={counts.sent} tone="ok" onClick={() => onShow('flow:qualified')} />
        {flow.dataStep && (
          <FunnelRow label="Confirmaram os dados" value={fc.confirmed} base={counts.sent} tone="ok" onClick={() => onShow('flow:confirmed')} />
        )}
      </div>

      <div className="stats">
        <button type="button" className="stat tone-ok clickable" onClick={() => onShow('flow:qualified')}>
          <span className="stat-value">{formatNumber(fc.qualified)}</span>
          <span className="stat-label">Qualificados</span>
        </button>
        {flow.dataStep && (
          <button type="button" className="stat tone-info clickable" onClick={() => onShow('flow:awaiting_data')}>
            <span className="stat-value">{formatNumber(fc.awaitingData)}</span>
            <span className="stat-label">Confirmando dados</span>
          </button>
        )}
        <button type="button" className="stat tone-info clickable" onClick={() => onShow('flow:awaiting')}>
          <span className="stat-value">{formatNumber(fc.awaiting)}</span>
          <span className="stat-label">Aguardando faturamento</span>
        </button>
        <button type="button" className="stat tone-muted clickable" onClick={() => onShow('flow:no_interest')}>
          <span className="stat-value">{formatNumber(fc.notInterested)}</span>
          <span className="stat-label">Sem interesse</span>
        </button>
        <button type="button" className="stat tone-muted clickable" onClick={() => onShow('flow:no_reply')}>
          <span className="stat-value">{formatNumber(fc.noReply)}</span>
          <span className="stat-label">Sem resposta</span>
        </button>
      </div>

      <div>
        <h3 className="subhead">Faturamento informado</h3>
        <div className="ranges">
          {flow.options.map((o, i) => (
            <div className="range-row" key={i}>
              <span className="range-label">
                {o.label}
                {o.qualified && <span className="badge tone-ok">qualificado</span>}
              </span>
              <span className="funnel-bar">
                <span className={`funnel-fill tone-${o.qualified ? 'ok' : 'warn'}`} style={{ width: `${(fc.byOption[i] / maxOption) * 100}%` }} />
              </span>
              <strong className="range-value">{formatNumber(fc.byOption[i])}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={() => onShow('flow:qualified')}>
          <Users size={16} /> Ver qualificados
        </button>
        <a className="btn primary" href={api.exportUrl(campaign.id, 'qualified')} download>
          <Download size={16} /> Exportar qualificados
        </a>
        <a className="btn" href={api.exportUrl(campaign.id, 'interested')} download>
          <Download size={16} /> Exportar interessados
        </a>
      </div>

      <RecentReplies recent={responses?.recent} />
    </div>
  )
}
