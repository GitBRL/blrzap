import { useCallback, useEffect, useRef, useState } from 'react'
import { History, LogOut, Megaphone, Receipt, Settings, Workflow } from 'lucide-react'
import { api } from './api.js'
import InstanceStatus from './components/InstanceStatus.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import NewCampaign from './components/NewCampaign.jsx'
import Campaigns from './components/Campaigns.jsx'
import Login from './components/Login.jsx'
import WorkflowsPage from './components/workflow/WorkflowsPage.jsx'
import Cobranca from './components/cobranca/Cobranca.jsx'

export default function App() {
  const [auth, setAuth] = useState(null) // { authEnabled, authenticated, user, expired? }

  useEffect(() => {
    api
      .me()
      .then(setAuth)
      .catch(() => setAuth({ authEnabled: true, authenticated: false }))
    const onExpired = () => setAuth((a) => (a?.authenticated && a.authEnabled ? { ...a, authenticated: false, expired: true } : a))
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  if (!auth) return <div className="boot muted">Carregando…</div>

  const onLogin = (user) => setAuth({ authEnabled: true, authenticated: true, user })

  if (auth.authEnabled && !auth.authenticated && !auth.expired) return <Login onSuccess={onLogin} />

  const logout = async () => {
    await api.logout().catch(() => {})
    setAuth({ authEnabled: true, authenticated: false })
  }

  return (
    <>
      <Dashboard user={auth.authEnabled ? auth.user : null} onLogout={logout} />
      {/* Sessão expirada: login por cima do painel, sem perder o que estava na tela */}
      {auth.expired && !auth.authenticated && (
        <div className="login-overlay">
          <Login expired onSuccess={onLogin} />
        </div>
      )}
    </>
  )
}

function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('new')
  const [selectedId, setSelectedId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [instance, setInstance] = useState(null)
  // Sobe a cada workflow salvo, para a nova campanha reler a lista
  const [workflowsVersion, setWorkflowsVersion] = useState(0)
  // Workflow a abrir no canvas ('new' cria um), pedido pela tela de nova campanha
  const [workflowToOpen, setWorkflowToOpen] = useState(undefined)
  const promptedSetup = useRef(false)
  const bumpWorkflows = useCallback(() => setWorkflowsVersion((v) => v + 1), [])
  const clearWorkflowToOpen = useCallback(() => setWorkflowToOpen(undefined), [])

  const refreshInstance = useCallback(async () => {
    try {
      setInstance(await api.instance())
    } catch (err) {
      setInstance({ configured: true, state: 'error', error: err.message })
    }
  }, [])

  useEffect(() => {
    refreshInstance()
    const t = setInterval(refreshInstance, 30_000)
    return () => clearInterval(t)
  }, [refreshInstance])

  // Abre a configuração automaticamente só na primeira vez em que faltar a conexão
  useEffect(() => {
    if (instance && !instance.configured && !promptedSetup.current) {
      promptedSetup.current = true
      setSettingsOpen(true)
    }
  }, [instance])

  const openCampaign = (id) => {
    setSelectedId(id)
    setTab('history')
  }

  const editWorkflow = (id) => {
    setWorkflowToOpen(id || 'new')
    setTab('workflows')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Megaphone size={18} />
          </span>
          <span className="brand-name">Disparos</span>
        </div>

        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>
            <Megaphone size={16} /> Nova campanha
          </button>
          <button
            role="tab"
            aria-selected={tab === 'history'}
            className={tab === 'history' ? 'active' : ''}
            onClick={() => setTab('history')}
          >
            <History size={16} /> Campanhas
          </button>
          <button
            role="tab"
            aria-selected={tab === 'workflows'}
            className={tab === 'workflows' ? 'active' : ''}
            onClick={() => setTab('workflows')}
          >
            <Workflow size={16} /> Workflows
          </button>
          <button
            role="tab"
            aria-selected={tab === 'cobranca'}
            className={tab === 'cobranca' ? 'active' : ''}
            onClick={() => setTab('cobranca')}
          >
            <Receipt size={16} /> Cobrança
          </button>
        </nav>

        <div className="topbar-right">
          <InstanceStatus instance={instance} onClick={() => setSettingsOpen(true)} />
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Configurações da uazapi" aria-label="Configurações">
            <Settings size={18} />
          </button>
          {user && (
            <div className="user-menu">
              <span className="user-name" title="Usuário conectado">
                {user}
              </span>
              <button className="icon-btn" onClick={onLogout} title="Sair" aria-label="Sair">
                <LogOut size={18} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="content">
        {/* As duas telas ficam montadas para não perder o CSV/template ao trocar de aba */}
        <div hidden={tab !== 'new'}>
          <NewCampaign instance={instance} onCreated={openCampaign} workflowsVersion={workflowsVersion} onEditWorkflow={editWorkflow} />
        </div>
        <div hidden={tab !== 'history'}>
          <Campaigns active={tab === 'history'} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setTab('new')} />
        </div>
        <div hidden={tab !== 'workflows'}>
          <WorkflowsPage openId={workflowToOpen} onOpened={clearWorkflowToOpen} onChanged={bumpWorkflows} />
        </div>
        <div hidden={tab !== 'cobranca'}>
          <Cobranca active={tab === 'cobranca'} />
        </div>
      </main>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={refreshInstance}
          instance={instance}
        />
      )}
    </div>
  )
}
