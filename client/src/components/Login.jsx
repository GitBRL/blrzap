import { useState } from 'react'
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Megaphone } from 'lucide-react'
import { api } from '../api.js'

export default function Login({ onSuccess, expired }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(expired ? 'Sua sessão expirou. Entre novamente.' : '')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.login({ username, password, remember })
      onSuccess(res.user)
    } catch (err) {
      setError(err.message)
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark large" aria-hidden>
            <Megaphone size={22} />
          </span>
          <h1>Disparos</h1>
          <p className="muted">Entre para acessar o painel</p>
        </div>

        <label className="field">
          <span>Usuário</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <div className="input-group">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Manter conectado por 30 dias</span>
        </label>

        {error && (
          <div className="callout bad" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn primary large" disabled={loading || !password}>
          {loading ? <LoaderCircle size={18} className="spin" /> : <LockKeyhole size={18} />} Entrar
        </button>
      </form>
    </div>
  )
}
