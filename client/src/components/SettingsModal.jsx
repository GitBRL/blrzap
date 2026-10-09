import { useEffect, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, X } from 'lucide-react'
import { api } from '../api.js'

export default function SettingsModal({ onClose, onSaved, instance }) {
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [current, setCurrent] = useState(null)
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        setCurrent(cfg)
        setBaseUrl(cfg.baseUrl)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const cfg = await api.saveConfig({ baseUrl, token })
      setCurrent(cfg)
      setToken('')
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-head">
          <h2 id="settings-title">Conexão com a uazapi</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <p className="muted small">
          Use a <strong>Server URL</strong> e o <strong>token da instância</strong> que aparecem no painel da uazapi. O token fica
          salvo apenas no servidor desta aplicação.
        </p>

        <label className="field">
          <span>Server URL</span>
          <input
            type="url"
            placeholder="https://seusubdominio.uazapi.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Token da instância</span>
          <div className="input-group">
            <input
              type={showToken ? 'text' : 'password'}
              placeholder={current?.hasToken ? `Atual: ${current.tokenPreview} (deixe vazio para manter)` : 'Cole o token aqui'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required={!current?.hasToken}
              autoComplete="off"
            />
            <button type="button" className="btn ghost" onClick={() => setShowToken((v) => !v)} aria-label="Mostrar token">
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <small className="muted">
            É o token da instância (o número conectado), não o <strong>admintoken</strong> do servidor. O admintoken só
            administra o servidor e é recusado no envio de mensagens.
          </small>
        </label>

        {instance?.configured && (
          <div className={`callout ${instance.connected ? 'ok' : 'warn'}`}>
            {instance.connected
              ? `Instância conectada${instance.profileName ? ` como ${instance.profileName}` : ''}${instance.number ? ` (${instance.number})` : ''}.`
              : instance.error || `Instância ${instance.state === 'connecting' ? 'conectando' : 'desconectada'}. Conecte o WhatsApp pelo painel da uazapi.`}
          </div>
        )}
        {error && <div className="callout bad">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving && <LoaderCircle size={16} className="spin" />} Salvar e testar
          </button>
        </div>
      </form>
    </div>
  )
}
