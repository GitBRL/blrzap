import { useCallback, useEffect, useState } from 'react'
import { Megaphone, Plus } from 'lucide-react'
import { api } from '../api.js'
import { formatDateTime, formatNumber, formatWhen } from '../utils.js'
import { ProgressBar, StatusBadge } from './StatusBadge.jsx'
import CampaignDetail from './CampaignDetail.jsx'

export default function Campaigns({ active, selectedId, onSelect, onNew }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setList(await api.campaigns())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const busy = list?.some((c) => ['running', 'queued', 'scheduled'].includes(c.status))

  useEffect(() => {
    if (!active) return
    refresh()
    const t = setInterval(refresh, busy ? 3000 : 15000)
    return () => clearInterval(t)
  }, [active, busy, refresh])

  useEffect(() => {
    if (list?.length && !list.some((c) => c.id === selectedId)) onSelect(list[0].id)
  }, [list, selectedId, onSelect])

  if (list && !list.length) {
    return (
      <div className="empty-state">
        <Megaphone size={36} />
        <h2>Nenhuma campanha ainda</h2>
        <p className="muted">Importe um CSV e crie seu primeiro disparo.</p>
        <button className="btn primary" onClick={onNew}>
          <Plus size={16} /> Nova campanha
        </button>
      </div>
    )
  }

  return (
    <div className="campaigns">
      <aside className="campaign-list">
        {error && <div className="callout bad">{error}</div>}
        {!list && <p className="muted">Carregando…</p>}
        {list?.map((c) => {
          const done = c.counts.total - c.counts.pending
          return (
            <button key={c.id} className={`campaign-item ${c.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(c.id)}>
              <div className="campaign-item-head">
                <strong>{c.name}</strong>
                <StatusBadge status={c.status} />
              </div>
              <ProgressBar counts={c.counts} />
              <div className="muted small campaign-item-meta">
                <span>
                  {formatNumber(done)}/{formatNumber(c.counts.total)}
                </span>
                <span>{c.status === 'scheduled' && c.scheduledFor ? `📅 ${formatWhen(c.scheduledFor)}` : formatDateTime(c.createdAt)}</span>
              </div>
            </button>
          )
        })}
      </aside>

      <section className="campaign-detail-wrap">
        {selectedId && (
          <CampaignDetail
            key={selectedId}
            id={selectedId}
            active={active}
            onChanged={refresh}
            onDeleted={() => {
              onSelect(null)
              refresh()
            }}
          />
        )}
      </section>
    </div>
  )
}
