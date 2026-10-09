const STATES = {
  connected: { label: 'Conectado', tone: 'ok' },
  connecting: { label: 'Conectando…', tone: 'warn' },
  hibernated: { label: 'Hibernado', tone: 'warn' },
  disconnected: { label: 'Desconectado', tone: 'bad' },
  error: { label: 'Erro de conexão', tone: 'bad' },
}

export default function InstanceStatus({ instance, onClick }) {
  let label = 'Verificando…'
  let tone = 'muted'
  let detail = ''

  if (instance && !instance.configured) {
    label = 'Não configurado'
    tone = 'warn'
  } else if (instance) {
    const s = STATES[instance.state] || { label: instance.state, tone: 'warn' }
    label = s.label
    tone = s.tone
    detail = instance.profileName || instance.number || ''
  }

  return (
    <button className={`status-pill tone-${tone}`} onClick={onClick} title={instance?.error || 'Status da instância uazapi'}>
      <span className="dot" />
      <span>{label}</span>
      {detail && <span className="status-detail">· {detail}</span>}
    </button>
  )
}
