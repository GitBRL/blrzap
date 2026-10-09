import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Megaphone, Settings } from 'lucide-react'
import { api } from './api.js'
import InstanceStatus from './components/InstanceStatus.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import NewCampaign from './components/NewCampaign.jsx'
import Campaigns from './components/Campaigns.jsx'

export default function App() {
  const [tab, setTab] = useState('new')
  const [selectedId, setSelectedId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [instance, setInstance] = useState(null)
  const promptedSetup = useRef(false)

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
        </nav>

        <div className="topbar-right">
          <InstanceStatus instance={instance} onClick={() => setSettingsOpen(true)} />
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Configurações da uazapi" aria-label="Configurações">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="content">
        {/* As duas telas ficam montadas para não perder o CSV/template ao trocar de aba */}
        <div hidden={tab !== 'new'}>
          <NewCampaign instance={instance} onCreated={openCampaign} />
        </div>
        <div hidden={tab !== 'history'}>
          <Campaigns active={tab === 'history'} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setTab('new')} />
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
