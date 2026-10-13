import { useMemo } from 'react'
import { Clock, Download, RotateCcw, Tag } from 'lucide-react'
import { NODE_TYPES } from '@shared/workflow.js'
import { api } from '../api.js'
import { formatNumber } from '../utils.js'
import { ListenerStatus, RecentReplies, useResponses } from './FlowResults.jsx'
import { BLOCK_ICONS } from './workflow/icons.js'

/** Os blocos na ordem do caminho (a partir do disparo), e os soltos no fim. */
function orderedNodes(wf) {
  const start = wf.nodes.find((n) => n.type === 'start')
  const order = []
  const seen = new Set()
  const queue = start ? [start.id] : []
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    const node = wf.nodes.find((n) => n.id === id)
    if (node) order.push(node)
    for (const e of wf.edges) if (e.source === id) queue.push(e.target)
  }
  return [...order, ...wf.nodes.filter((n) => !seen.has(n.id))]
}

function Count({ value, label, tone = 'info', onClick }) {
  return (
    <button type="button" className={`stat tone-${tone} clickable`} onClick={onClick}>
      <span className="stat-value">{formatNumber(value)}</span>
      <span className="stat-label">{label}</span>
    </button>
  )
}

export default function WorkflowResults({ campaign, onShow, onRetryWebhooks }) {
  const { workflow: wf, workflowCounts: wc } = campaign
  const responses = useResponses()
  const nodes = useMemo(() => orderedNodes(wf), [wf])
  const tags = Object.entries(wc.tags).sort((a, b) => b[1] - a[1])

  return (
    <div className="flow-results">
      <ListenerStatus status={responses} />

      {wc.webhooks.failed > 0 && (
        <div className="callout bad">
          {formatNumber(wc.webhooks.failed)} {wc.webhooks.failed === 1 ? 'envio ao webhook falhou' : 'envios ao webhook falharam'}.
          <div className="callout-actions">
            <button className="btn small" onClick={() => onShow('flow:webhook_failed')}>
              Ver contatos
            </button>
            <button className="btn small" onClick={onRetryWebhooks}>
              <RotateCcw size={14} /> Reenviar falhas
            </button>
          </div>
        </div>
      )}

      <div className="stats">
        <Count value={wc.started} label="Entraram no workflow" onClick={() => onShow('status:sent')} />
        <Count value={wc.replied} label="Responderam" tone="ok" onClick={() => onShow('flow:replied')} />
        <Count value={wc.waiting} label="Aguardando resposta" onClick={() => onShow('flow:active')} />
        <Count value={wc.done} label="Chegaram ao fim" tone="ok" onClick={() => onShow('flow:done')} />
        <Count value={wc.noReply} label="Sem resposta" tone="muted" onClick={() => onShow('flow:no_reply')} />
      </div>

      {tags.length > 0 && (
        <div>
          <h3 className="subhead">Etiquetas</h3>
          <div className="wf-tag-results">
            {tags.map(([tag, n]) => (
              <div className="wf-tag-result" key={tag}>
                <button type="button" className="link" onClick={() => onShow(`flow:tag:${tag}`)}>
                  <Tag size={14} /> {tag}
                </button>
                <strong>{formatNumber(n)}</strong>
                <a className="icon-btn" href={api.exportUrl(campaign.id, `tag:${tag}`)} download title={`Exportar “${tag}”`} aria-label={`Exportar ${tag}`}>
                  <Download size={16} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="subhead">Por bloco — {wf.name}</h3>
        <div className="wf-node-results">
          {nodes.map((n) => {
            const stats = wc.byNode[n.id] || { reached: 0, waiting: 0, timeouts: 0, choices: [] }
            const Icon = BLOCK_ICONS[n.type]
            const max = Math.max(1, ...stats.choices)
            return (
              <div className="wf-node-result" key={n.id}>
                <div className="wf-node-result-head">
                  <Icon size={15} />
                  <strong>{n.data.title || NODE_TYPES[n.type]?.label}</strong>
                  <span className="muted small">{NODE_TYPES[n.type]?.label}</span>
                  <span className="wf-node-result-nums">
                    <button type="button" className="link small" onClick={() => onShow(`flow:reached:${n.id}`)}>
                      {formatNumber(stats.reached)} passaram
                    </button>
                    {stats.waiting > 0 && (
                      <button type="button" className="link small" onClick={() => onShow(`flow:waiting:${n.id}`)}>
                        {formatNumber(stats.waiting)} aguardando aqui
                      </button>
                    )}
                    {stats.timeouts > 0 && (
                      <span className="small muted">
                        <Clock size={12} /> {formatNumber(stats.timeouts)} sem resposta
                      </span>
                    )}
                  </span>
                </div>
                {n.data.choices?.length > 0 && (
                  <div className="ranges">
                    {n.data.choices.map((c, i) => (
                      <button type="button" className="range-row clickable" key={i} onClick={() => onShow(`flow:choice:${n.id}.${i}`)}>
                        <span className="range-label">
                          {c.label}
                          {c.tag && <span className="badge tone-ok">{c.tag}</span>}
                        </span>
                        <span className="funnel-bar">
                          <span className="funnel-fill tone-info" style={{ width: `${((stats.choices[i] || 0) / max) * 100}%` }} />
                        </span>
                        <strong className="range-value">{formatNumber(stats.choices[i] || 0)}</strong>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="actions">
        <a className="btn primary" href={api.exportUrl(campaign.id)} download>
          <Download size={16} /> Exportar todos
        </a>
        <a className="btn" href={api.exportUrl(campaign.id, 'replied')} download>
          <Download size={16} /> Exportar quem respondeu
        </a>
        <a className="btn" href={api.exportUrl(campaign.id, 'done')} download>
          <Download size={16} /> Exportar quem chegou ao fim
        </a>
      </div>

      <RecentReplies recent={responses?.recent} />
    </div>
  )
}
