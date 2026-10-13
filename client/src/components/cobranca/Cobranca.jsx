import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Download, LoaderCircle, Play, Save } from 'lucide-react'
import { formatDateBR, formatMoney } from '@shared/dunning.js'
import { api } from '../../api.js'
import { browserTimeZone, formatNumber } from '../../utils.js'
import Titulos from './Titulos.jsx'
import Ligacoes from './Ligacoes.jsx'
import Etapas from './Etapas.jsx'
import ConfigRegua from './ConfigRegua.jsx'
import Envios from './Envios.jsx'

function Tile({ label, value, sub, tone = 'muted', onClick }) {
  return (
    <button type="button" className={`stat tone-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </button>
  )
}

/** Área "Cobrança": títulos, ligações do dia, etapas da régua e configurações. */
export default function Cobranca({ active }) {
  const [sub, setSub] = useState('titulos')
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null) // configuração em edição (Etapas + Configurações)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [titleFilter, setTitleFilter] = useState('open')
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const d = await api.regua()
      setData(d)
      setDraft((current) => current ?? d.config)
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message })
    }
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [active, refresh])

  const changed = useCallback(() => {
    refresh()
    setVersion((v) => v + 1)
  }, [refresh])

  const editConfig = (next) => {
    setDraft(next)
    setDirty(true)
  }

  const saveConfig = async () => {
    setBusy('save')
    setNotice(null)
    try {
      const saved = await api.saveRegua({ ...draft, timeZone: browserTimeZone() })
      setDraft(saved)
      setDirty(false)
      setNotice({ tone: 'ok', text: 'Régua salva.' })
      refresh()
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message })
    } finally {
      setBusy('')
    }
  }

  const runNow = async () => {
    if (dirty && !window.confirm('Há alterações não salvas na régua. Executar com a versão salva?')) return
    if (!window.confirm('Executar a régua de hoje agora? Etapas que já rodaram hoje não se repetem.')) return
    setBusy('run')
    setNotice(null)
    try {
      const r = await api.runRegua()
      const n = (count, one, many) => `${count} ${count === 1 ? one : many}`
      const parts = [
        n(r.executed, 'etapa', 'etapas'),
        `${r.whatsapp} WhatsApp`,
        n(r.email + r.internal, 'e-mail', 'e-mails'),
        n(r.calls, 'ligação', 'ligações'),
        r.broken && n(r.broken, 'promessa não cumprida', 'promessas não cumpridas'),
        r.skipped && n(r.skipped, 'etapa pulada (fora da tolerância)', 'etapas puladas (fora da tolerância)'),
      ].filter(Boolean)
      setNotice({ tone: 'ok', text: `Régua executada: ${parts.join(' · ')}.` })
      changed()
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message })
    } finally {
      setBusy('')
    }
  }

  if (!data || !draft) return <p className="muted">Carregando…</p>

  const { stats, config } = data
  const lastRun = stats.runs[0]
  const showTitles = (filter) => {
    setTitleFilter(filter)
    setSub('titulos')
  }

  return (
    <div className="cobranca">
      <section className="card regua-head">
        <div className="regua-head-top">
          <div>
            <h2>Régua de cobrança</h2>
            <span className={`badge ${config.enabled ? 'tone-ok' : 'tone-muted'}`}>
              {config.enabled ? <span className="pulse" /> : null}
              {config.enabled ? 'Ativa' : 'Desativada'}
            </span>{' '}
            <span className="muted small">
              {config.enabled && stats.nextRun
                ? `Próxima execução: ${formatDateBR(stats.nextRun.date)} às ${stats.nextRun.time}`
                : 'Ative em Configurações para rodar todo dia automaticamente.'}
              {lastRun && ` · última: ${formatDateBR(lastRun.date)}${lastRun.manual ? ' (manual)' : ''}`}
            </span>
          </div>
          <div className="actions">
            <a className="btn" href={api.reguaExportUrl()} download>
              <Download size={16} /> Exportar
            </a>
            <button className="btn primary" onClick={runNow} disabled={!!busy}>
              {busy === 'run' ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />} Executar agora
            </button>
          </div>
        </div>

        <div className="stats regua-stats">
          <Tile label="Em aberto" value={formatNumber(stats.open.count)} sub={formatMoney(stats.open.total)} onClick={() => showTitles('open')} />
          <Tile label="Vencidos" value={formatNumber(stats.overdue.count)} sub={formatMoney(stats.overdue.total)} tone="bad" onClick={() => showTitles('overdue')} />
          <Tile label="Vencem em 7 dias" value={formatNumber(stats.upcoming.count)} sub={formatMoney(stats.upcoming.total)} tone="warn" onClick={() => showTitles('upcoming')} />
          <Tile label="Pagos no mês" value={formatNumber(stats.paidMonth.count)} sub={formatMoney(stats.paidMonth.total)} tone="ok" onClick={() => showTitles('paid')} />
          <Tile label="Promessas ativas" value={formatNumber(stats.promises)} tone="info" onClick={() => showTitles('promise')} />
          <Tile label="Ligações pendentes" value={formatNumber(stats.tasksOpen)} tone={stats.tasksOpen ? 'warn' : 'muted'} onClick={() => setSub('ligacoes')} />
        </div>

        {notice && <div className={`callout ${notice.tone}`}>{notice.text}</div>}
      </section>

      <div className="subtabs">
        {[
          ['titulos', 'Títulos'],
          ['envios', 'Envios'],
          ['ligacoes', `Ligações${stats.tasksOpen ? ` (${stats.tasksOpen})` : ''}`],
          ['etapas', 'Etapas da régua'],
          ['config', 'Configurações'],
        ].map(([key, label]) => (
          <button key={key} className={sub === key ? 'active' : ''} onClick={() => setSub(key)}>
            {label}
          </button>
        ))}
      </div>

      {(sub === 'etapas' || sub === 'config') && dirty && (
        <div className="save-bar">
          <CalendarClock size={16} />
          <span>Alterações não salvas na régua.</span>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => {
              setDraft(config)
              setDirty(false)
            }}
            disabled={!!busy}
          >
            Descartar
          </button>
          <button className="btn primary" onClick={saveConfig} disabled={!!busy}>
            {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Salvar régua
          </button>
        </div>
      )}

      {sub === 'titulos' && <Titulos active={active} filter={titleFilter} setFilter={setTitleFilter} version={version} onChanged={changed} />}
      {sub === 'envios' && <Envios active={active} version={version} onChanged={changed} />}
      {sub === 'ligacoes' && <Ligacoes active={active} version={version} onChanged={changed} />}
      {sub === 'etapas' && <Etapas config={draft} setConfig={editConfig} />}
      {sub === 'config' && <ConfigRegua config={draft} setConfig={editConfig} />}
    </div>
  )
}
