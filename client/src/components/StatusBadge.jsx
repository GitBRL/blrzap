export const CAMPAIGN_STATUS = {
  scheduled: { label: 'Agendada', tone: 'info' },
  queued: { label: 'Na fila', tone: 'info' },
  running: { label: 'Enviando', tone: 'ok' },
  paused: { label: 'Pausada', tone: 'warn' },
  completed: { label: 'Concluída', tone: 'muted' },
  cancelled: { label: 'Cancelada', tone: 'bad' },
}

export const CONTACT_STATUS = {
  pending: { label: 'Pendente', tone: 'muted' },
  sent: { label: 'Enviado', tone: 'ok' },
  failed: { label: 'Falha', tone: 'bad' },
  invalid: { label: 'Inválido', tone: 'warn' },
  skipped: { label: 'Ignorado', tone: 'muted' },
}

export function StatusBadge({ status, map = CAMPAIGN_STATUS }) {
  const s = map[status] || { label: status, tone: 'muted' }
  return (
    <span className={`badge tone-${s.tone}`}>
      {status === 'running' && <span className="pulse" />}
      {s.label}
    </span>
  )
}

export function ProgressBar({ counts }) {
  const { total, sent, failed, invalid, skipped } = counts
  const pct = (n) => (total ? (n / total) * 100 : 0)
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct(total - counts.pending))} aria-valuemin={0} aria-valuemax={100}>
      <span className="seg ok" style={{ width: `${pct(sent)}%` }} />
      <span className="seg bad" style={{ width: `${pct(failed)}%` }} />
      <span className="seg warn" style={{ width: `${pct(invalid + skipped)}%` }} />
    </div>
  )
}
