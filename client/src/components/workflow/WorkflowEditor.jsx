import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, LoaderCircle, Save } from 'lucide-react'
import {
  ADDABLE_TYPES,
  defaultNodeData,
  NODE_TYPES,
  nextNodeId,
  outputsOf,
  savedVariables,
  SYSTEM_VARS,
  workflowProblems,
  workflowWarnings,
} from '@shared/workflow.js'
import { api } from '../../api.js'
import BlockNode from './BlockNode.jsx'
import { BLOCK_ICONS } from './icons.js'
import NodeInspector from './NodeInspector.jsx'

const nodeTypes = { block: BlockNode }
const edgeDefaults = { type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } }
const edgeId = (source, handle, target) => `e-${source}-${handle || 'next'}-${target}`

const toFlowNodes = (wf) =>
  wf.nodes.map((n) => ({
    id: n.id,
    type: 'block',
    position: n.position,
    deletable: n.type !== 'start',
    data: { blockType: n.type, config: n.data },
  }))

const toFlowEdges = (wf) =>
  wf.edges.map((e) => ({ ...edgeDefaults, id: edgeId(e.source, e.sourceHandle, e.target), source: e.source, sourceHandle: e.sourceHandle || 'next', target: e.target }))

/** Do estado do canvas para o formato salvo (o mesmo que o servidor valida). */
const toDoc = (meta, nodes, edges) => ({
  ...meta,
  nodes: nodes.map((n) => ({
    id: n.id,
    type: n.data.blockType,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: n.data.config,
  })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle || 'next', target: e.target })),
})

const START_STUB = { id: 'stub', type: 'start', position: { x: 0, y: 0 }, data: defaultNodeData('start') }

/** Problema só deste bloco (para pintar a borda), sem os problemas do workflow inteiro. */
function nodeProblem(n) {
  const node = { id: n.id, type: n.data.blockType, position: n.position, data: n.data.config }
  const list = workflowProblems({ name: 'x', nodes: node.type === 'start' ? [node] : [START_STUB, node], edges: [] })
  return list.filter((p) => !/bloco de disparo|Dê um nome/.test(p))[0] || ''
}

export default function WorkflowEditor(props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  )
}

function Editor({ id, onBack, onSaved }) {
  const [meta, setMeta] = useState(null) // { name, description }
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const [showProblems, setShowProblems] = useState(false)
  const rf = useReactFlow()
  const wrapper = useRef(null)
  const nodesReady = useNodesInitialized()
  const fitted = useRef(false)

  // Enquadra o fluxo inteiro quando os blocos já foram medidos (o fitView do início roda antes)
  useEffect(() => {
    if (!nodesReady || fitted.current) return
    fitted.current = true
    // Sem afastar além de 0,6: abaixo disso o texto dos blocos não se lê. Quando o fluxo não cabe,
    // a vista começa pelo disparo (à esquerda) e o resto se alcança arrastando.
    requestAnimationFrame(() =>
      Promise.resolve(rf.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.6 })).then(() => {
        const vp = rf.getViewport()
        const bounds = rf.getNodesBounds(rf.getNodes())
        if (bounds.x * vp.zoom + vp.x < 0) rf.setViewport({ ...vp, x: 24 - bounds.x * vp.zoom })
      }),
    )
  }, [nodesReady, rf])

  useEffect(() => {
    let alive = true
    api
      .workflow(id)
      .then((wf) => {
        if (!alive) return
        setMeta({ name: wf.name, description: wf.description || '' })
        setNodes(toFlowNodes(wf))
        setEdges(toFlowEdges(wf))
      })
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [id])

  const doc = useMemo(() => (meta ? toDoc(meta, nodes, edges) : null), [meta, nodes, edges])
  const problems = useMemo(() => (doc ? workflowProblems(doc) : []), [doc])
  const warnings = useMemo(() => (doc ? workflowWarnings(doc) : []), [doc])
  const vars = useMemo(() => [...SYSTEM_VARS.map((v) => v.name), ...(doc ? savedVariables(doc).map((v) => v.name) : [])], [doc])
  const viewNodes = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, problem: nodeProblem(n) } })), [nodes])
  const selected = nodes.find((n) => n.id === selectedId) || null

  const save = useCallback(async () => {
    if (!doc || saving) return
    setSaving(true)
    setError('')
    try {
      await api.saveWorkflow(id, doc)
      setDirty(false)
      setSavedAt(Date.now())
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [doc, id, onSaved, saving])

  // Ctrl+S salva; sair da página com alteração pendente pede confirmação
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    const onUnload = (e) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [save, dirty])

  const onNodesChange = useCallback((changes) => {
    setNodes((nds) => {
      // O bloco de disparo não sai do canvas
      const allowed = changes.filter((c) => !(c.type === 'remove' && nds.find((n) => n.id === c.id)?.data.blockType === 'start'))
      return applyNodeChanges(allowed, nds)
    })
    if (changes.some((c) => c.type === 'position' || c.type === 'remove')) setDirty(true)
    if (changes.some((c) => c.type === 'remove' && c.id === selectedId)) setSelectedId(null)
  }, [selectedId])

  const onEdgesChange = useCallback((changes) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
    if (changes.some((c) => c.type === 'remove')) setDirty(true)
  }, [])

  // Uma saída leva a um bloco só: ligar de novo substitui a seta anterior
  const onConnect = useCallback((conn) => {
    const handle = conn.sourceHandle || 'next'
    setEdges((eds) =>
      addEdge(
        { ...edgeDefaults, ...conn, sourceHandle: handle, id: edgeId(conn.source, handle, conn.target) },
        eds.filter((e) => !(e.source === conn.source && (e.sourceHandle || 'next') === handle)),
      ),
    )
    setDirty(true)
  }, [])

  const isValidConnection = useCallback((c) => nodes.find((n) => n.id === c.target)?.data.blockType !== 'start', [nodes])

  const updateConfig = (nodeId, config) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)))
    // Saída que deixou de existir (opção removida, prazo desligado) leva a seta junto
    const valid = new Set(outputsOf({ id: nodeId, type: node.data.blockType, data: config }).map((o) => o.id))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId || valid.has(e.sourceHandle || 'next')))
    setDirty(true)
  }

  const addBlock = (type) => {
    const newId = nextNodeId(doc)
    const rect = wrapper.current?.getBoundingClientRect()
    const position = rect
      ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2 - 130, y: rect.top + rect.height / 3 })
      : { x: 0, y: 0 }
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      { id: newId, type: 'block', position, selected: true, data: { blockType: type, config: defaultNodeData(type) } },
    ])
    setSelectedId(newId)
    setDirty(true)
  }

  const deleteBlock = (nodeId) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedId(null)
    setDirty(true)
  }

  const back = () => {
    if (dirty && !window.confirm('Sair sem salvar as alterações deste workflow?')) return
    onBack()
  }

  if (!meta) {
    return <div className="empty-state">{error ? <div className="callout bad">{error}</div> : <LoaderCircle className="spin" />}</div>
  }

  return (
    <div className="wf-editor">
      <div className="wf-bar">
        <button className="btn ghost" onClick={back}>
          <ArrowLeft size={16} /> Workflows
        </button>
        <input
          className="wf-name"
          value={meta.name}
          maxLength={80}
          onChange={(e) => {
            setMeta({ ...meta, name: e.target.value })
            setDirty(true)
          }}
          aria-label="Nome do workflow"
        />
        <span className="muted small wf-status">{dirty ? 'Alterações não salvas' : savedAt ? 'Salvo' : ''}</span>
        <button
          type="button"
          className={`badge ${problems.length ? 'tone-warn' : 'tone-ok'} wf-problems-toggle`}
          onClick={() => setShowProblems((v) => !v)}
          title="Ver o que impede usar este workflow numa campanha"
        >
          {problems.length ? `${problems.length} ${problems.length === 1 ? 'problema' : 'problemas'}` : 'Pronto para usar'}
        </button>
        <button className="btn primary" onClick={save} disabled={saving || !dirty}>
          {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Salvar
        </button>
      </div>
      {error && <div className="callout bad">{error}</div>}
      {showProblems && (problems.length > 0 || warnings.length > 0) && (
        <ul className="problems wf-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {warnings.map((w) => (
            <li key={w} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="wf-main">
        <div className="wf-palette" aria-label="Adicionar bloco">
          <span className="muted small">Adicionar</span>
          {ADDABLE_TYPES.map((t) => {
            const Icon = BLOCK_ICONS[t]
            return (
              <button key={t} type="button" className={`wf-palette-btn t-${t}`} onClick={() => addBlock(t)} title={NODE_TYPES[t].hint}>
                <Icon size={16} /> {NODE_TYPES[t].label}
              </button>
            )
          })}
        </div>

        <div className="wf-canvas" ref={wrapper}>
          <ReactFlow
            nodes={viewNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            defaultEdgeOptions={edgeDefaults}
            deleteKeyCode={['Backspace', 'Delete']}
            minZoom={0.2}
            colorMode="system"
          >
            <Background gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="wf-inspector">
          {selected ? (
            <>
              <h3 className="wf-inspector-title">
                {(() => {
                  const Icon = BLOCK_ICONS[selected.data.blockType]
                  return <Icon size={16} />
                })()}
                {NODE_TYPES[selected.data.blockType].label}
              </h3>
              <NodeInspector
                key={selected.id}
                node={selected}
                vars={vars}
                workflow={doc}
                onChange={(config) => updateConfig(selected.id, config)}
                onDelete={() => deleteBlock(selected.id)}
              />
            </>
          ) : (
            <div className="wf-inspector-body">
              <h3 className="wf-inspector-title">Workflow</h3>
              <label className="field">
                <span>Descrição</span>
                <textarea
                  rows={3}
                  maxLength={300}
                  value={meta.description}
                  onChange={(e) => {
                    setMeta({ ...meta, description: e.target.value })
                    setDirty(true)
                  }}
                  placeholder="Para que serve este workflow"
                />
              </label>
              <div className="wf-tips">
                <strong>Como montar</strong>
                <ul>
                  <li>Clique num bloco para editar. Adicione blocos pela barra à esquerda.</li>
                  <li>Arraste da bolinha de uma saída (cada botão, “Seguir”, “Sim/Não”, “Sem resposta”) até outro bloco para ligar.</li>
                  <li>Saída sem seta encerra o caminho do contato ali.</li>
                  <li>Selecione um bloco ou uma seta e aperte Delete para remover.</li>
                  <li>Use {'{{coluna}}'} para colunas da planilha e {'{{variável}}'} para respostas guardadas.</li>
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>

      <datalist id="wf-vars">
        {vars.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </div>
  )
}
