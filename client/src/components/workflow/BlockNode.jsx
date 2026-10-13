import { memo, useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Clock, Image, MessageSquare } from 'lucide-react'
import { describeFilters } from '@shared/filters.js'
import { ANSWER_TYPES, NODE_TYPES, outputsOf } from '@shared/workflow.js'
import { BLOCK_ICONS } from './icons.js'

const cut = (s, n = 110) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** O resumo que aparece dentro do bloco, para ler o fluxo sem abrir cada um. */
function Summary({ type, data }) {
  if (type === 'start') return <p className="muted">Mensagem e mídia da campanha{data.choices.length ? ', com as opções abaixo' : ''}.</p>
  if (type === 'message') {
    return (
      <p>
        {data.media?.url && <Image size={13} className="inline-icon" />}
        {cut(data.text) || <span className="muted">Sem texto</span>}
      </p>
    )
  }
  if (type === 'question') {
    const kind = ANSWER_TYPES.find((t) => t.value === data.answerType)?.label || 'Texto'
    return (
      <>
        <p>{cut(data.text) || <span className="muted">Sem pergunta</span>}</p>
        <p className="muted small">
          Guarda em {data.saveAs ? <code>{`{{${data.saveAs}}}`}</code> : '—'} · {kind}
        </p>
      </>
    )
  }
  if (type === 'data') {
    const labels = (data.fields || []).map((f) => f.label).filter(Boolean)
    return <p>{labels.length ? labels.join(' · ') : <span className="muted">Sem dados</span>}</p>
  }
  if (type === 'condition') return <p>{describeFilters(data) || <span className="muted">Regra incompleta</span>}</p>
  if (type === 'webhook') {
    const host = String(data.url || '').replace(/^https?:\/\/([^/]+).*/, '$1')
    const keys = (data.fields || []).filter((f) => f.key).length
    return (
      <p>
        {host || <span className="muted">Sem URL</span>}
        {host && <span className="muted"> · {keys} {keys === 1 ? 'dado' : 'dados'}</span>}
      </p>
    )
  }
  return null
}

function BlockNode({ id, data, selected }) {
  const { blockType: type, config, problem } = data
  const Icon = BLOCK_ICONS[type] || MessageSquare
  const outs = outputsOf({ id, type, data: config })
  const updateInternals = useUpdateNodeInternals()
  const handleKey = outs.map((o) => o.id).join(',')

  // Saídas mudam quando opções são adicionadas/removidas: o canvas precisa medir de novo
  useEffect(() => updateInternals(id), [id, handleKey, updateInternals])

  return (
    <div className={`wf-node t-${type}${selected ? ' selected' : ''}${problem ? ' has-problem' : ''}`} title={problem || undefined}>
      {type !== 'start' && <Handle type="target" position={Position.Left} className="wf-in" />}
      <div className="wf-node-head">
        <Icon size={15} />
        <span className="wf-node-type">{NODE_TYPES[type]?.label}</span>
        {config.title && <strong className="wf-node-title">{config.title}</strong>}
      </div>
      <div className="wf-node-body">
        <Summary type={type} data={config} />
      </div>
      <div className="wf-node-outs">
        {outs.map((o) => (
          <div className={`wf-out${o.id === 'timeout' ? ' timeout' : ''}${o.id === 'no' ? ' no' : ''}`} key={o.id}>
            {o.id === 'timeout' && <Clock size={12} />}
            <span>{o.label}</span>
            {config.choices?.[Number(o.id.slice(1))]?.tag && o.id.startsWith('c') && (
              <span className="wf-tag">{config.choices[Number(o.id.slice(1))].tag}</span>
            )}
            <Handle type="source" position={Position.Right} id={o.id} className="wf-handle" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(BlockNode)
