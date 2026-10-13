import { useEffect, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, Mail, Save, Send, Smartphone, Trash2 } from 'lucide-react'
import { WEEKDAYS } from '@shared/schedule.js'
import { api } from '../../api.js'
import { WindowSettings } from '../SendSettings.jsx'
import { InstanceStrip } from './Envios.jsx'

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

/** Instância uazapi própria do financeiro (outro número), separada da das campanhas. */
function FinanceInstance() {
  const [info, setInfo] = useState(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .instanciaFinanceiro()
      .then((i) => {
        setInfo(i)
        setBaseUrl(i.baseUrl)
      })
      .catch((err) => setError(err.message))
  }, [])

  const save = async () => {
    setBusy('save')
    setError('')
    try {
      const i = await api.saveInstanciaFinanceiro({ baseUrl, token })
      setInfo(i)
      setToken('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!window.confirm('Remover a instância do financeiro? A régua passa a enviar pela instância das campanhas.')) return
    setBusy('remove')
    setError('')
    try {
      const i = await api.removeInstanciaFinanceiro()
      setInfo(i)
      setBaseUrl('')
      setToken('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  if (!info) return <p className="muted">{error || 'Carregando…'}</p>

  return (
    <div className="flow-editor">
      <InstanceStrip info={info} />
      <div className="grid-2">
        <Field label="Server URL">
          <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://seusubdominio.uazapi.com" />
        </Field>
        <Field label="Token da instância do financeiro" hint="O token da instância (não o admintoken). Fica salvo só no servidor.">
          <div className="input-group">
            <input
              type={show ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={info.hasToken ? `Atual: ${info.tokenPreview} (deixe vazio para manter)` : 'Cole o token aqui'}
              autoComplete="off"
            />
            <button type="button" className="btn ghost" onClick={() => setShow((v) => !v)} aria-label="Mostrar token">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={save} disabled={!!busy || !baseUrl.trim() || (!token.trim() && !info.hasToken)}>
          {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Salvar e testar
        </button>
        {info.configured && (
          <button className="btn danger-ghost" onClick={remove} disabled={!!busy}>
            {busy === 'remove' ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />} Remover instância própria
          </button>
        )}
      </div>
      {error && <div className="callout bad">{error}</div>}
    </div>
  )
}

/** SMTP: salvo à parte (a senha nunca volta para o navegador). */
function SmtpSettings() {
  const [smtp, setSmtp] = useState(null)
  const [pass, setPass] = useState('')
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    api
      .smtp()
      .then(setSmtp)
      .catch((err) => setNotice({ tone: 'bad', text: err.message }))
  }, [])

  if (!smtp) return <p className="muted">Carregando…</p>
  const set = (patch) => setSmtp({ ...smtp, ...patch })

  const save = async () => {
    setBusy('save')
    setNotice(null)
    try {
      setSmtp(await api.saveSmtp({ ...smtp, pass }))
      setPass('')
      setNotice({ tone: 'ok', text: 'SMTP salvo.' })
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message })
    } finally {
      setBusy('')
    }
  }

  const test = async () => {
    setBusy('test')
    setNotice(null)
    try {
      await api.testSmtp(testTo)
      setNotice({ tone: 'ok', text: `E-mail de teste enviado para ${testTo}.` })
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flow-editor">
      <div className="grid-3">
        <Field label="Servidor SMTP">
          <input value={smtp.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.gmail.com" />
        </Field>
        <Field label="Porta">
          <input type="number" value={smtp.port} onChange={(e) => set({ port: Number(e.target.value) })} />
        </Field>
        <label className="check smtp-secure">
          <input type="checkbox" checked={smtp.secure} onChange={(e) => set({ secure: e.target.checked })} />
          <span>
            SSL/TLS direto
            <small className="muted">Porta 465. Na 587, deixe desmarcado (STARTTLS).</small>
          </span>
        </label>
      </div>
      <div className="grid-2">
        <Field label="Usuário">
          <input value={smtp.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Senha" hint={smtp.hasPass ? 'Deixe vazio para manter a senha atual.' : 'No Gmail/Outlook, use uma senha de app.'}>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" placeholder={smtp.hasPass ? '••••••••' : ''} />
        </Field>
        <Field label="Nome do remetente">
          <input value={smtp.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Financeiro — Sua Empresa" />
        </Field>
        <Field label="E-mail do remetente">
          <input type="email" value={smtp.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} placeholder="financeiro@suaempresa.com.br" />
        </Field>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={save} disabled={!!busy}>
          {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Salvar SMTP
        </button>
        <span className="spacer" />
        <input className="smtp-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Enviar teste para…" />
        <button className="btn" onClick={test} disabled={!!busy || !testTo}>
          {busy === 'test' ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Testar
        </button>
      </div>
      {notice && <div className={`callout ${notice.tone}`}>{notice.text}</div>}
    </div>
  )
}

/** Configurações gerais da régua (salvas pela barra "Salvar régua"). */
export default function ConfigRegua({ config, setConfig }) {
  const set = (patch) => setConfig({ ...config, ...patch })
  const setSending = (patch) => set({ sending: { ...config.sending, ...patch } })
  const setPromise = (patch) => set({ promise: { ...config.promise, ...patch } })
  const toggleDay = (d) => set({ days: config.days.includes(d) ? config.days.filter((x) => x !== d) : [...config.days, d].sort() })

  return (
    <>
      <section className="card">
        <label className={`check big-toggle ${config.enabled ? 'on' : ''}`}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>
            <strong>Régua ativa</strong>
            <small className="muted">Executa todo dia no horário abaixo. Desativada, nada é enviado automaticamente (você ainda pode usar Executar agora).</small>
          </span>
        </label>

        <h3 className="subhead">Agenda</h3>
        <div className="grid-3">
          <Field label="Horário de execução" hint="Horário de Brasília">
            <input type="time" value={config.runAt} onChange={(e) => set({ runAt: e.target.value })} />
          </Field>
          <Field label="Limite para registrar ligações" hint="Depois disso, a mensagem da etapa sai sozinha">
            <input type="time" value={config.callCutoff} onChange={(e) => set({ callCutoff: e.target.value })} />
          </Field>
          <Field label="Tolerância de atraso (dias)" hint="Etapas que passaram há mais tempo são puladas">
            <input type="number" min={0} max={30} value={config.catchupDays} onChange={(e) => set({ catchupDays: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="field">
          <span>Dias em que a régua roda</span>
          <div className="weekday-picker" role="group" aria-label="Dias da régua">
            {WEEKDAYS.map((label, d) => (
              <button key={d} type="button" className={config.days.includes(d) ? 'active' : ''} aria-pressed={config.days.includes(d)} onClick={() => toggleDay(d)}>
                {label}
              </button>
            ))}
          </div>
          <small className="muted">Num dia sem execução, a etapa daquele dia roda na execução seguinte (dentro da tolerância).</small>
        </div>

        <h3 className="subhead">Ritmo do WhatsApp</h3>
        <div className="grid-3">
          <Field label="Intervalo mínimo (seg)">
            <input type="number" min={1} value={config.sending.minDelay} onChange={(e) => setSending({ minDelay: Number(e.target.value) })} />
          </Field>
          <Field label="Intervalo máximo (seg)">
            <input type="number" min={1} value={config.sending.maxDelay} onChange={(e) => setSending({ maxDelay: Number(e.target.value) })} />
          </Field>
          <Field label="Simular “digitando…” (seg)">
            <input type="number" min={0} max={30} value={config.sending.typingSeconds} onChange={(e) => setSending({ typingSeconds: Number(e.target.value) })} />
          </Field>
        </div>
        <WindowSettings window={config.sending.window} setWindow={(window) => setSending({ window })} />
        <p className="muted small">Acompanhe, pause e reenvie as falhas na aba Envios.</p>

        <h3 className="subhead">Promessas de pagamento</h3>
        <label className="check">
          <input type="checkbox" checked={config.promise.confirmEnabled} onChange={(e) => setPromise({ confirmEnabled: e.target.checked })} />
          <span>Confirmar a promessa por WhatsApp (registrada na ligação)</span>
        </label>
        {config.promise.confirmEnabled && (
          <textarea rows={3} value={config.promise.confirmTemplate} onChange={(e) => setPromise({ confirmTemplate: e.target.value })} />
        )}
        <label className="check">
          <input type="checkbox" checked={config.promise.brokenEnabled} onChange={(e) => setPromise({ brokenEnabled: e.target.checked })} />
          <span>
            Avisar quando a promessa não for cumprida
            <small className="muted">Enviado no dia seguinte à data prometida; depois a régua continua.</small>
          </span>
        </label>
        {config.promise.brokenEnabled && (
          <textarea rows={3} value={config.promise.brokenTemplate} onChange={(e) => setPromise({ brokenTemplate: e.target.value })} />
        )}
      </section>

      <section className="card">
        <h3 className="card-title">
          <Smartphone size={16} /> WhatsApp do financeiro
        </h3>
        <p className="muted small">
          Conecte uma instância uazapi própria (outro número) para a cobrança. Ela envia em paralelo, com fila e ritmo próprios, sem interferir
          nas campanhas. Sem ela, a régua usa a instância das campanhas e divide a fila com elas.
        </p>
        <FinanceInstance />
      </section>

      <section className="card">
        <h3 className="card-title">
          <Mail size={16} /> E-mail (SMTP)
        </h3>
        <p className="muted small">Usado nos e-mails da régua (boleto, lembretes e aviso ao jurídico).</p>
        <SmtpSettings />
      </section>
    </>
  )
}
