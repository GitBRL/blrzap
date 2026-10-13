import { useEffect, useState } from 'react'
import { Clock, HandCoins, LoaderCircle, MessageCircle, Phone, PhoneCall } from 'lucide-react'
import { CALL_ATTEMPTS, CALL_RESULTS, formatDateBR, formatMoney } from '@shared/dunning.js'
import { api } from '../../api.js'
import { formatDateTime, formatTime, localDateKey } from '../../utils.js'
import { DayBadge } from './Titulos.jsx'

function TaskCard({ task, onResolved }) {
  const t = task.title
  const [attempts, setAttempts] = useState(task.attempts)
  const [note, setNote] = useState('')
  const [promiseDate, setPromiseDate] = useState(localDateKey(3))
  const [askPromise, setAskPromise] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const resolve = async (result) => {
    setBusy(result)
    setError('')
    try {
      await api.resolveTarefa(task.id, { result, attempts, note, promiseDate: result === 'promise' ? promiseDate : undefined })
      onResolved()
    } catch (err) {
      setError(err.message)
      setBusy('')
    }
  }

  const spin = (name) => busy === name && <LoaderCircle size={14} className="spin" />
  const tel = `+${t.telefone}`

  return (
    <article className="task-card">
      <header>
        <span className="badge tone-warn">{task.stageLabel}</span>
        <strong>{task.stageName}</strong>
        <span className="spacer" />
        <span className="muted small" title="Depois disso, a mensagem e o e-mail da etapa saem automaticamente">
          <Clock size={13} /> até {formatTime(task.cutoffAt).slice(0, 5)}
        </span>
      </header>
      <p className="muted small task-objective">{task.objective}</p>

      <div className="task-client">
        <div>
          <strong>{t.nome}</strong>
          <span className="muted small block">
            {formatMoney(t.valor)} · venceu em {formatDateBR(t.vencimento)} <DayBadge diff={t.diff} />
          </span>
        </div>
        <div className="actions">
          <a className="btn small" href={`tel:${tel}`}>
            <Phone size={14} /> Ligar
          </a>
          <a className="btn small" href={`https://wa.me/${t.telefone}`} target="_blank" rel="noreferrer">
            <MessageCircle size={14} /> WhatsApp
          </a>
        </div>
      </div>

      <div className="task-attempts">
        {Object.keys(attempts).map((key) => (
          <label className="check" key={key}>
            <input type="checkbox" checked={attempts[key]} onChange={(e) => setAttempts({ ...attempts, [key]: e.target.checked })} />
            <span>{CALL_ATTEMPTS[key]} feita</span>
          </label>
        ))}
      </div>

      <input className="task-note" placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />

      {askPromise ? (
        <div className="reschedule">
          <span className="small">Pagamento prometido para</span>
          <input type="date" value={promiseDate} min={localDateKey(0)} onChange={(e) => setPromiseDate(e.target.value)} />
          <button className="btn primary small" onClick={() => resolve('promise')} disabled={!!busy || !promiseDate}>
            {spin('promise')} Registrar promessa
          </button>
          <button className="btn ghost small" onClick={() => setAskPromise(false)}>
            Voltar
          </button>
        </div>
      ) : (
        <div className="task-results">
          <button className="btn primary small" onClick={() => setAskPromise(true)} disabled={!!busy}>
            <HandCoins size={14} /> {CALL_RESULTS.promise}
          </button>
          <button className="btn small" onClick={() => resolve('no_deal')} disabled={!!busy}>
            {spin('no_deal')} {CALL_RESULTS.no_deal}
          </button>
          <button className="btn small" onClick={() => resolve('no_answer')} disabled={!!busy}>
            {spin('no_answer')} {CALL_RESULTS.no_answer}
          </button>
          <button className="btn small" onClick={() => resolve('paid')} disabled={!!busy}>
            {spin('paid')} {CALL_RESULTS.paid}
          </button>
        </div>
      )}
      {error && <div className="callout bad small">{error}</div>}
    </article>
  )
}

const RESULT_TONE = { promise: 'ok', paid: 'ok', no_deal: 'warn', no_answer: 'warn', expired: 'muted' }

/** Ligações do dia (etapas D+7, D+15, D+30, D+45) e o histórico de resultados. */
export default function Ligacoes({ active, version, onChanged }) {
  const [view, setView] = useState('open')
  const [tasks, setTasks] = useState(null)
  const [localVersion, setLocalVersion] = useState(0)

  useEffect(() => {
    if (!active) return
    let alive = true
    const load = () =>
      api
        .tarefas(view === 'open' ? 'open' : 'all')
        .then((list) => alive && setTasks(view === 'open' ? list : list.filter((x) => x.status !== 'open').reverse()))
        .catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [active, view, version, localVersion])

  const resolved = () => {
    setLocalVersion((v) => v + 1)
    onChanged()
  }

  return (
    <section className="card">
      <div className="segmented" role="radiogroup" aria-label="Ligações">
        {[
          ['open', 'Pendentes'],
          ['done', 'Resolvidas'],
        ].map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'open' && (
        <p className="muted small">
          Ligue, marque as tentativas e registre o resultado. Promessa suspende a régua até a data combinada. Sem registro até o horário
          limite, a mensagem de WhatsApp e o e-mail da etapa saem automaticamente.
        </p>
      )}

      {!tasks && <p className="muted">Carregando…</p>}
      {tasks && !tasks.length && (
        <div className="empty-state compact">
          <PhoneCall size={30} />
          <p className="muted">{view === 'open' ? 'Nenhuma ligação pendente.' : 'Nenhuma ligação resolvida ainda.'}</p>
        </div>
      )}

      {view === 'open' ? (
        <div className="task-grid">
          {tasks?.map((task) => task.title && <TaskCard key={task.id} task={task} onResolved={resolved} />)}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Cliente</th>
                <th>Resultado</th>
                <th>Tentativas</th>
                <th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {tasks?.map((task) => (
                <tr key={task.id}>
                  <td className="nowrap">
                    <strong>{task.stageLabel}</strong> {task.stageName}
                  </td>
                  <td>{task.title?.nome || '—'}</td>
                  <td>
                    <span className={`badge tone-${RESULT_TONE[task.result] || 'muted'}`}>
                      {task.status === 'cancelled' ? 'Cancelada (título pago)' : CALL_RESULTS[task.result] || task.result}
                    </span>
                    {task.promiseDate && <span className="muted small block">para {formatDateBR(task.promiseDate)}</span>}
                    {task.note && <span className="muted small block">{task.note}</span>}
                  </td>
                  <td className="small">
                    {Object.entries(task.attempts)
                      .map(([k, v]) => `${CALL_ATTEMPTS[k]}: ${v ? 'sim' : 'não'}`)
                      .join(' · ')}
                  </td>
                  <td className="nowrap muted">{task.resolvedAt ? formatDateTime(task.resolvedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
