import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Download, Filter, LoaderCircle, Pause, Play, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import { describeWindow, estimateFinish } from '@shared/schedule.js'
import { api } from '../api.js'
import {
  estimateSeconds,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTime,
  formatWhen,
  nextFullHour,
  toLocalInput,
} from '../utils.js'
import { ProgressBar, StatusBadge } from './StatusBadge.jsx'
import ContactsTable from './ContactsTable.jsx'
import FlowResults from './FlowResults.jsx'

function Stat({ label, value, tone }) {
  return (
    <div className={`stat tone-${tone}`}>
      <span className="stat-value">{formatNumber(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function useNow(enabled) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

export default function CampaignDetail({ id, active, onChanged, onDeleted }) {
  const [c, setC] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(null)
  const [acting, setActing] = useState('')
  const [version, setVersion] = useState(0)
  const [contactFilter, setContactFilter] = useState('')

  const live = c?.status === 'running' || c?.status === 'queued'
  const scheduled = c?.status === 'scheduled'
  const [rescheduleInput, setRescheduleInput] = useState(null) // string do datetime-local enquanto edita
  const hasFlow = Boolean(c?.flow)
  const now = useNow((live || scheduled) && active)
  const currentTab = tab || (hasFlow ? 'responses' : 'log')

  const refresh = useCallback(async () => {
    try {
      setC(await api.campaign(id))
      setVersion((v) => v + 1)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  // Atualiza durante o envio e, em campanhas com botões, enquanto chegam respostas
  useEffect(() => {
    if (!active) return
    refresh()
    if (!live && !hasFlow && !scheduled) return
    const t = setInterval(refresh, live ? 2000 : 5000)
    return () => clearInterval(t)
  }, [active, live, hasFlow, scheduled, refresh])

  const showContacts = (filter) => {
    setContactFilter(filter)
    setTab('contacts')
  }

  const act = async (action, confirmText, body) => {
    if (confirmText && !window.confirm(confirmText)) return
    setActing(action)
    try {
      if (action === 'delete') {
        await api.remove(id)
        onDeleted()
        return
      }
      await api.action(id, action, body)
      setRescheduleInput(null)
      await refresh()
      onChanged()
    } catch (err) {
      alert(err.message)
    } finally {
      setActing('')
    }
  }

  if (error && !c) return <div className="callout bad">{error}</div>
  if (!c) return <p className="muted">Carregando…</p>

  const { counts } = c
  const done = counts.total - counts.pending
  const pct = counts.total ? Math.round((done / counts.total) * 100) : 0
  const nextIn = c.nextSendAt ? Math.max(0, Math.round((c.nextSendAt - now) / 1000)) : null
  const canRetry = counts.failed > 0 && !live
  const finished = c.status === 'completed' || c.status === 'cancelled'

  const icon = (name, Icon) => (acting === name ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} />)

  return (
    <div className="card detail">
      <div className="detail-head">
        <div>
          <h2>{c.name}</h2>
          <span className="muted small">
            Criada em {formatDateTime(c.createdAt)}
            {c.finishedAt && ` · finalizada em ${formatDateTime(c.finishedAt)}`}
          </span>
        </div>
        <StatusBadge status={c.status} />
      </div>

      <div className="actions">
        {scheduled && c.scheduleReason === 'start' && (
          <button className="btn primary" onClick={() => act('start-now', 'Começar o disparo agora?')} disabled={!!acting}>
            {icon('start-now', Play)} Iniciar agora
          </button>
        )}
        {(scheduled || c.status === 'paused') && counts.pending > 0 && rescheduleInput === null && (
          <button
            className="btn"
            onClick={() => setRescheduleInput(toLocalInput(c.scheduledFor && c.scheduledFor > Date.now() ? c.scheduledFor : nextFullHour()))}
            disabled={!!acting}
          >
            <CalendarClock size={16} /> Reagendar
          </button>
        )}
        {(live || scheduled) && (
          <button className="btn" onClick={() => act('pause')} disabled={!!acting}>
            {icon('pause', Pause)} Pausar
          </button>
        )}
        {c.status === 'paused' && counts.pending > 0 && (
          <button className="btn primary" onClick={() => act('resume')} disabled={!!acting}>
            {icon('resume', Play)} Retomar
          </button>
        )}
        {canRetry && (
          <button
            className="btn"
            onClick={() => act('retry-failed', `Reenviar para os ${counts.failed} contatos com falha?`)}
            disabled={!!acting}
          >
            {icon('retry-failed', RefreshCw)} Reenviar falhas
          </button>
        )}
        {!finished && (
          <button className="btn danger-ghost" onClick={() => act('cancel', 'Cancelar o disparo? Os contatos pendentes não receberão a mensagem.')} disabled={!!acting}>
            {icon('cancel', X)} Cancelar
          </button>
        )}
        <span className="spacer" />
        <a className="btn" href={api.exportUrl(id)} download>
          <Download size={16} /> Exportar CSV
        </a>
        {!live && (
          <button className="btn danger-ghost" onClick={() => act('delete', 'Excluir esta campanha e seu histórico?')} disabled={!!acting} title="Excluir">
            {icon('delete', Trash2)}
          </button>
        )}
      </div>

      {rescheduleInput !== null && (
        <div className="reschedule">
          <input
            type="datetime-local"
            value={rescheduleInput}
            min={toLocalInput(Date.now())}
            onChange={(e) => setRescheduleInput(e.target.value)}
            aria-label="Nova data e hora"
          />
          <button
            className="btn primary"
            disabled={!rescheduleInput || !!acting}
            onClick={() => act('reschedule', null, { startAt: new Date(rescheduleInput).getTime() })}
          >
            {icon('reschedule', CalendarClock)} Salvar agendamento
          </button>
          <button className="btn ghost" onClick={() => setRescheduleInput(null)}>
            Cancelar
          </button>
        </div>
      )}

      {scheduled && c.scheduledFor && (
        <div className="callout info">
          <CalendarClock size={16} />
          <span>
            {c.scheduleReason === 'window'
              ? `Fora da janela de envio (${describeWindow(c.settings.window)}). Retoma ${formatWhen(c.scheduledFor)}`
              : `Agendada para ${formatWhen(c.scheduledFor)}`}{' '}
            — {c.scheduledFor > now ? `em ${formatDuration((c.scheduledFor - now) / 1000)}` : 'iniciando…'}
          </span>
        </div>
      )}

      {c.lastError && (
        <div className="callout bad">
          <TriangleAlert size={16} /> {c.lastError}
        </div>
      )}

      <div className="progress-block">
        <div className="progress-labels">
          <strong>{pct}% processado</strong>
          <span className="muted small">
            {c.status === 'running' && nextIn !== null
              ? c.pauseReason === 'batch'
                ? `Pausa entre lotes — retoma em ${formatDuration(nextIn)}`
                : `Próximo envio em ${nextIn}s`
              : ''}
            {live && counts.pending > 0 && ` · restante estimado ${formatDuration(estimateSeconds(counts.pending, c.settings))}`}
            {live && counts.pending > 0 && c.settings.window?.enabled &&
              ` · término previsto ${formatWhen(estimateFinish(now, estimateSeconds(counts.pending, c.settings), c.settings.window))}`}
          </span>
        </div>
        <ProgressBar counts={counts} />
      </div>

      <div className="stats">
        <Stat label="Enviadas" value={counts.sent} tone="ok" />
        <Stat label="Falhas" value={counts.failed} tone="bad" />
        <Stat label="Inválidos / ignorados" value={counts.invalid + counts.skipped} tone="warn" />
        <Stat label="Pendentes" value={counts.pending} tone="muted" />
      </div>

      <div className="subtabs">
        {hasFlow && (
          <button className={currentTab === 'responses' ? 'active' : ''} onClick={() => setTab('responses')}>
            Respostas
            {c.flowCounts.qualified > 0 && <span className="tab-count">{formatNumber(c.flowCounts.qualified)}</span>}
          </button>
        )}
        <button className={currentTab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          Atividade
        </button>
        <button className={currentTab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>
          Contatos
        </button>
        <button className={currentTab === 'message' ? 'active' : ''} onClick={() => setTab('message')}>
          Mensagem e ritmo
        </button>
      </div>

      {currentTab === 'responses' && hasFlow && (
        <FlowResults campaign={c} onShow={showContacts} onRetryWebhooks={() => act('retry-webhooks')} />
      )}

      {currentTab === 'log' && (
        <ul className="log">
          {c.log.map((entry, i) => (
            <li key={`${entry.at}-${i}`} className={`log-${entry.level}`}>
              <span className="log-time">{formatTime(entry.at)}</span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      )}

      {currentTab === 'contacts' && (
        <ContactsTable
          id={id}
          version={version}
          hasFlow={hasFlow}
          dataFields={c.flow?.dataStep?.fields || []}
          hasWebhook={Boolean(c.flow?.webhook)}
          filter={contactFilter}
          setFilter={setContactFilter}
        />
      )}

      {currentTab === 'message' && (
        <div className="message-info">
          {c.filters && (
            <p className="filter-note">
              <Filter size={14} /> Filtro: {c.filters.text} — {formatNumber(c.filters.keptRows)} de {formatNumber(c.filters.totalRows)} linhas
            </p>
          )}
          {c.media && (
            <p>
              <strong>Anexo:</strong> {c.media.type} — {c.media.fileName || c.media.url}
            </p>
          )}
          <pre className="template-view">{c.template || '(sem texto)'}</pre>
          {hasFlow && (
            <div className="flow-summary">
              <p>
                <strong>Botões:</strong> “{c.flow.buttons.yes}” · “{c.flow.buttons.no}”
              </p>
              <p>
                <strong>Pergunta:</strong> {c.flow.question}
              </p>
              <p>
                <strong>Faixas:</strong>{' '}
                {c.flow.options.map((o) => `${o.label}${o.qualified ? ' ✓' : ''}`).join(' · ')}
              </p>
              {c.flow.dataStep && (
                <p>
                  <strong>Confirmação de dados:</strong> {c.flow.dataStep.fields.map((f) => f.label).join(', ')}
                </p>
              )}
              {c.flow.webhook && (
                <p>
                  <strong>Webhook:</strong> {c.flow.webhook.url.replace(/^(https?:\/\/[^/]+).*/, '$1/…')} —{' '}
                  {c.flow.webhook.fields.map((f) => f.key).join(', ')}
                  {c.flow.webhook.includeSheet && ', planilha_*'}
                </p>
              )}
            </div>
          )}
          <p className="muted small">
            Intervalo de {c.settings.minDelay}–{c.settings.maxDelay}s
            {c.settings.batchSize > 0 && c.settings.batchPause > 0 &&
              ` · pausa de ${c.settings.batchPause} min a cada ${c.settings.batchSize} mensagens`}
            {c.settings.typingSeconds > 0 && ` · digitando ${c.settings.typingSeconds}s`}
            {c.settings.validateNumbers && ' · verificação de números ativa'}
            {c.settings.window?.enabled && ` · janela: ${describeWindow(c.settings.window)}`}
            {c.startAt && ` · agendada para ${formatWhen(c.startAt)}`}
          </p>
        </div>
      )}
    </div>
  )
}
