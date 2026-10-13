import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Copy, LoaderCircle, PencilRuler, Plus, Trash2, Workflow } from 'lucide-react'
import { DEFAULT_DATA_STEP, DEFAULT_WEBHOOK } from '@shared/datafields.js'
import { emptyWorkflow, LEGACY_FLOW_DEFAULTS, legacyFlowToWorkflow } from '@shared/workflow.js'
import { api } from '../../api.js'
import { formatDateTime, storageGet, storageSet } from '../../utils.js'
// O canvas (e a biblioteca dele) só carrega quando alguém abre um workflow
const WorkflowEditor = lazy(() => import('./WorkflowEditor.jsx'))

const LEGACY_KEY = 'disparos.flow.v2'
const LEGACY_DONE = 'disparos.flow.migrated'

/** O fluxo de botões que estava configurado neste navegador antes dos workflows, se houver. */
function legacyFlowInBrowser() {
  if (storageGet(LEGACY_DONE, false)) return null
  const saved = storageGet(LEGACY_KEY, null)
  if (!saved || typeof saved !== 'object' || !Object.keys(saved).length) return null
  return {
    ...LEGACY_FLOW_DEFAULTS,
    ...saved,
    buttons: { ...LEGACY_FLOW_DEFAULTS.buttons, ...saved.buttons },
    replies: { ...LEGACY_FLOW_DEFAULTS.replies, ...saved.replies },
    dataStep: { ...DEFAULT_DATA_STEP, ...saved.dataStep },
    webhook: { ...DEFAULT_WEBHOOK, ...saved.webhook },
  }
}

export default function WorkflowsPage({ openId, onOpened, onChanged }) {
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [legacy, setLegacy] = useState(legacyFlowInBrowser)

  const load = useCallback(() => {
    api
      .workflows()
      .then(setList)
      .catch((err) => setError(err.message))
  }, [])

  useEffect(load, [load])

  const create = useCallback(
    async (wf = emptyWorkflow()) => {
      setBusy('new')
      setError('')
      try {
        const created = await api.createWorkflow(wf)
        onChanged()
        setEditing(created.id)
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy('')
      }
    },
    [onChanged],
  )

  // "Editar"/"Criar" vindos da tela de nova campanha
  useEffect(() => {
    if (openId === undefined) return
    if (openId === 'new') create()
    else if (openId) setEditing(openId)
    onOpened()
  }, [openId, onOpened, create])

  const duplicate = async (id) => {
    setBusy(id)
    try {
      await api.duplicateWorkflow(id)
      onChanged()
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const remove = async (wf) => {
    if (!window.confirm(`Excluir o workflow “${wf.name}”? Campanhas já criadas com ele continuam funcionando.`)) return
    try {
      await api.removeWorkflow(wf.id)
      onChanged()
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const importLegacy = async () => {
    await create(legacyFlowToWorkflow(legacy, 'Qualificação por faturamento (configuração anterior)'))
    storageSet(LEGACY_DONE, true)
    setLegacy(null)
  }

  if (editing) {
    return (
      <Suspense
        fallback={
          <div className="empty-state">
            <LoaderCircle className="spin" />
          </div>
        }
      >
        <WorkflowEditor
          id={editing}
          onBack={() => {
            setEditing(null)
            load()
          }}
          onSaved={onChanged}
        />
      </Suspense>
    )
  }

  return (
    <div className="workflows">
      <div className="workflows-head">
        <div>
          <h1>Workflows</h1>
          <p className="muted">
            Templates do caminho que segue o disparo: cada resposta do contato leva a uma mensagem, pergunta, condição ou webhook. A campanha
            guarda uma cópia, então editar aqui não muda campanhas já criadas.
          </p>
        </div>
        <button className="btn primary" onClick={() => create()} disabled={busy === 'new'}>
          {busy === 'new' ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />} Novo workflow
        </button>
      </div>

      {error && <div className="callout bad">{error}</div>}

      {legacy && (
        <div className="callout warn">
          <div>
            Este navegador tem uma configuração do antigo “Com botões de interesse”. Importe para não perder textos e faixas que você
            personalizou.
            <div className="callout-actions">
              <button className="btn small" onClick={importLegacy} disabled={busy === 'new'}>
                Importar como workflow
              </button>
              <button
                className="btn small ghost"
                onClick={() => {
                  storageSet(LEGACY_DONE, true)
                  setLegacy(null)
                }}
              >
                Ignorar
              </button>
            </div>
          </div>
        </div>
      )}

      {!list ? (
        <div className="empty-state">
          <LoaderCircle className="spin" />
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <Workflow size={32} />
          <h2>Nenhum workflow ainda</h2>
          <p>Crie um para enviar mensagens diferentes conforme cada resposta.</p>
        </div>
      ) : (
        <div className="wf-cards">
          {list.map((wf) => (
            <article className="card wf-card" key={wf.id}>
              <div className="wf-card-head">
                <h2>{wf.name}</h2>
                <span className={`badge ${wf.problems.length ? 'tone-warn' : 'tone-ok'}`}>
                  {wf.problems.length ? `${wf.problems.length} ${wf.problems.length === 1 ? 'problema' : 'problemas'}` : 'Pronto'}
                </span>
              </div>
              {wf.description && <p className="muted small">{wf.description}</p>}
              <p className="small">
                {wf.blocks} blocos
                {wf.startChoices.length > 0 && <> · botões: {wf.startChoices.map((c) => `“${c}”`).join(', ')}</>}
              </p>
              <p className="muted small">Atualizado {formatDateTime(wf.updatedAt)}</p>
              <div className="wf-card-actions">
                <button className="btn small primary" onClick={() => setEditing(wf.id)}>
                  <PencilRuler size={14} /> Abrir no canvas
                </button>
                <button className="btn small" onClick={() => duplicate(wf.id)} disabled={busy === wf.id}>
                  <Copy size={14} /> Duplicar
                </button>
                <button className="icon-btn" onClick={() => remove(wf)} title="Excluir" aria-label={`Excluir ${wf.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
