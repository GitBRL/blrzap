// Régua de cobrança: títulos, execução diária das etapas, tarefas de ligação e e-mails.
//
// Cada dia, no horário configurado, cada título em aberto recebe a etapa (D-7 … D+60) do dia.
// O WhatsApp vai por uma campanha interna do dia (mesmo executor das campanhas: ritmo, janela,
// pausa, relatório); o e-mail sai por SMTP; etapas com ligação viram tarefas para a equipe.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  addDays,
  CALL_RESULTS,
  daysBetween,
  DEFAULT_DUNNING,
  DEFAULT_STAGES,
  formatDateBR,
  formatMoney,
  isPaidStatus,
  parseDateKey,
  stageLabel,
  TITLE_FIELDS,
  titleVars,
  todayKey,
  weekdayOf,
} from '../shared/dunning.js'
import { parseNumber } from '../shared/filters.js'
import { normalizePhone } from '../shared/phone.js'
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts, zonedToUtc } from '../shared/schedule.js'
import { renderTemplate } from '../shared/template.js'
import { appendToCampaign, createSystemCampaign, onContactProcessed, skipPendingContacts } from './campaigns.js'
import { DATA_DIR } from './env.js'
import { ValidationError } from './errors.js'
import { sendMail } from './mailer.js'
import { listCampaigns } from './store.js'

const DIR = path.join(DATA_DIR, 'regua')
const CONFIG_FILE = path.join(DIR, 'config.json')
const STATE_FILE = path.join(DIR, 'state.json')
fs.mkdirSync(DIR, { recursive: true })

const HISTORY_LIMIT = 100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

const state = { titles: [], tasks: [], lastRunDate: null, runs: [], ...readJson(STATE_FILE, {}) }

let saveTimer = null
function save(immediate = false) {
  clearTimeout(saveTimer)
  if (immediate) return writeAtomic(STATE_FILE, state)
  saveTimer = setTimeout(() => writeAtomic(STATE_FILE, state), 800)
}

export const flushDunning = () => save(true)

const byId = (id) => state.titles.find((t) => t.id === id)
const tz = () => config.timeZone || DEFAULT_TIMEZONE
const today = () => todayKey(tz())

function history(t, text, level = 'info') {
  t.history.unshift({ at: Date.now(), level, text })
  if (t.history.length > HISTORY_LIMIT) t.history.length = HISTORY_LIMIT
  t.updatedAt = Date.now()
}

// ---- Configuração ---------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const str = (v, max = 5000) => String(v ?? '').slice(0, max)
const intIn = (v, min, max, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const validEmails = (list) =>
  str(list, 500)
    .split(/[,;\s]+/)
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .join(', ')

function normalizeStage(input, fallback, problems) {
  const base = fallback || { key: `etapa-${crypto.randomBytes(3).toString('hex')}`, name: 'Nova etapa', objective: '' }
  const offset = intIn(input.offset, -90, 365, base.offset ?? 0)
  const stage = {
    key: str(input.key || base.key, 40),
    offset,
    name: str(input.name, 80).trim() || base.name,
    phase: offset <= 0 ? 'preventiva' : 'recuperacao',
    objective: str(input.objective ?? base.objective, 300),
    enabled: input.enabled !== false,
    call: {
      enabled: Boolean(input.call?.enabled),
      attempts: (input.call?.attempts || []).filter((a) => a === 'phone' || a === 'whatsapp'),
    },
    whatsapp: {
      enabled: Boolean(input.whatsapp?.enabled),
      variants: (input.whatsapp?.variants || []).map((v) => str(v, 4000)).filter((v) => v.trim()).slice(0, 5),
    },
    email: {
      enabled: Boolean(input.email?.enabled),
      subject: str(input.email?.subject, 300),
      body: str(input.email?.body),
      attachBoleto: Boolean(input.email?.attachBoleto),
    },
    internal: {
      enabled: Boolean(input.internal?.enabled),
      to: validEmails(input.internal?.to),
      subject: str(input.internal?.subject, 300),
      body: str(input.internal?.body),
    },
  }
  if (stage.call.enabled && !stage.call.attempts.length) stage.call.attempts = ['phone']
  const label = `${stageLabel(offset)} (${stage.name})`
  if (stage.enabled) {
    if (stage.whatsapp.enabled && !stage.whatsapp.variants.length) problems.push(`${label}: escreva a mensagem de WhatsApp.`)
    if (stage.email.enabled && (!stage.email.subject.trim() || !stage.email.body.trim())) problems.push(`${label}: preencha assunto e texto do e-mail.`)
  }
  return stage
}

function normalizeConfig(input = {}, { lenient = false } = {}) {
  const d = DEFAULT_DUNNING
  const problems = []
  const time = (v, fallback) => (HHMM.test(v) ? v : fallback)
  const days = (v) => {
    const list = [...new Set((Array.isArray(v) ? v : []).map(Number))].filter((n) => n >= 0 && n <= 6).sort()
    return list.length ? list : d.days
  }
  const defaults = Object.fromEntries(DEFAULT_STAGES.map((s) => [s.key, s]))
  const stages = (Array.isArray(input.stages) ? input.stages : d.stages)
    .slice(0, 30)
    .map((s) => normalizeStage(s, defaults[s.key], problems))
    .sort((a, b) => a.offset - b.offset)
  const offsets = stages.map((s) => s.offset)
  if (new Set(offsets).size !== offsets.length) problems.push('Duas etapas estão no mesmo dia (marco). Use dias diferentes.')
  const sending = input.sending || d.sending
  const window = sending.window || d.sending.window
  const cfg = {
    enabled: Boolean(input.enabled),
    runAt: time(input.runAt, d.runAt),
    days: days(input.days),
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIMEZONE,
    callCutoff: time(input.callCutoff, d.callCutoff),
    catchupDays: intIn(input.catchupDays, 0, 30, d.catchupDays),
    sending: {
      minDelay: intIn(sending.minDelay, 1, 3600, d.sending.minDelay),
      maxDelay: intIn(sending.maxDelay, 1, 3600, d.sending.maxDelay),
      typingSeconds: intIn(sending.typingSeconds, 0, 30, d.sending.typingSeconds),
      window: {
        enabled: Boolean(window.enabled),
        start: time(window.start, '08:00'),
        end: time(window.end, '20:00'),
        days: days(window.days),
      },
    },
    promise: {
      confirmEnabled: input.promise?.confirmEnabled ?? d.promise.confirmEnabled,
      confirmTemplate: str(input.promise?.confirmTemplate ?? d.promise.confirmTemplate),
      brokenEnabled: input.promise?.brokenEnabled ?? d.promise.brokenEnabled,
      brokenTemplate: str(input.promise?.brokenTemplate ?? d.promise.brokenTemplate),
    },
    stages,
  }
  if (cfg.sending.maxDelay < cfg.sending.minDelay) cfg.sending.maxDelay = cfg.sending.minDelay
  if (cfg.sending.window.enabled && cfg.sending.window.end <= cfg.sending.window.start) {
    problems.push('O fim da janela de envio deve ser depois do início.')
  }
  if (problems.length && !lenient) throw new ValidationError(problems.join(' '))
  return cfg
}

let config = normalizeConfig(readJson(CONFIG_FILE, DEFAULT_DUNNING), { lenient: true })

export const getDunningConfig = () => config

export function saveDunningConfig(input) {
  config = normalizeConfig(input)
  writeAtomic(CONFIG_FILE, config)
  return config
}

const stageByKey = (key) => config.stages.find((s) => s.key === key)

// ---- Títulos ----------------------------------------------------------------------------

const titleKey = (t) => (t.numero ? `n:${t.numero}` : `k:${t.telefone}|${t.vencimento}|${t.valor}`)

/**
 * Importa ou atualiza títulos a partir das linhas do CSV.
 * Com "número do título" mapeado, ele identifica o título; sem ele, telefone + vencimento + valor.
 */
export function importTitles({ rows, mapping = {}, countryCode = '55' }) {
  if (!Array.isArray(rows) || !rows.length) throw new ValidationError('O CSV não possui linhas.')
  if (rows.length > 50_000) throw new ValidationError('Limite de 50.000 títulos por importação.')
  for (const f of TITLE_FIELDS.filter((f) => f.required)) {
    if (!mapping[f.key]) throw new ValidationError(`Escolha a coluna de "${f.label}".`)
  }

  const get = (row, key) => (mapping[key] ? String(row[mapping[key]] ?? '').trim() : '')
  const existing = new Map(state.titles.map((t) => [titleKey(t), t]))
  const result = { created: 0, updated: 0, paid: 0, restarted: 0, errors: [] }
  const now = Date.now()

  rows.forEach((row, i) => {
    const line = i + 2
    const nome = get(row, 'nome')
    const telefone = normalizePhone(get(row, 'telefone'), countryCode)
    const vencimento = parseDateKey(get(row, 'vencimento'))
    const valor = parseNumber(get(row, 'valor'))
    const missing = [!nome && 'nome', !telefone && 'telefone válido', !vencimento && 'vencimento válido', valor === null && 'valor'].filter(Boolean)
    if (missing.length) {
      result.errors.push({ line, error: `Sem ${missing.join(', ')}` })
      return
    }
    const email = get(row, 'email')
    const data = {
      numero: get(row, 'numero'),
      nome,
      telefone,
      telefoneRaw: get(row, 'telefone'),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : '',
      valor,
      vencimento,
      boleto: get(row, 'boleto'),
      pagamento: get(row, 'pagamento'),
      pix: get(row, 'pix'),
      vars: row,
    }
    const paid = mapping.status && isPaidStatus(get(row, 'status'))
    const key = titleKey(data)
    const t = existing.get(key)

    if (t) {
      const dueChanged = t.vencimento !== data.vencimento
      // Colunas que não vieram nesta planilha mantêm o valor atual
      for (const key of ['numero', 'email', 'boleto', 'pagamento', 'pix']) if (!mapping[key]) delete data[key]
      data.vars = { ...t.vars, ...row }
      Object.assign(t, data, { updatedAt: now })
      if (dueChanged && t.status === 'open') {
        // Novo vencimento (renegociação): a régua recomeça do zero
        t.steps = {}
        t.promise = null
        history(t, `Vencimento alterado para ${formatDateBR(data.vencimento)}. A régua recomeçou.`)
        result.restarted++
      }
      if (paid && t.status !== 'paid') {
        markPaid(t, 'Pago (importação do CSV)')
        result.paid++
      }
      result.updated++
    } else {
      const title = {
        id: crypto.randomUUID(),
        ...data,
        status: paid ? 'paid' : 'open',
        paused: false,
        paidAt: paid ? now : null,
        paidNote: paid ? 'Pago (importação do CSV)' : '',
        promise: null,
        steps: {},
        history: [],
        createdAt: now,
        updatedAt: now,
      }
      history(title, paid ? 'Importado já pago.' : 'Título importado.')
      state.titles.push(title)
      existing.set(key, title)
      result.created++
      if (paid) result.paid++
    }
  })

  save(true)
  return result
}

export function markPaid(t, note = 'Marcado como pago') {
  t.status = 'paid'
  t.paidAt = Date.now()
  t.paidNote = note
  if (t.promise?.status === 'active') t.promise.status = 'kept'
  history(t, `${note}. Régua encerrada para este título.`, 'success')
  // Cancela o que ainda não saiu: ligações, WhatsApp na fila e e-mails pendentes
  for (const task of state.tasks) {
    if (task.titleId === t.id && task.status === 'open') Object.assign(task, { status: 'cancelled', resolvedAt: Date.now() })
  }
  skipPendingContacts((ct) => ct.ref?.titleId === t.id, 'Título pago antes do envio')
  for (const job of mailQueue) if (job.titleId === t.id) job.cancelled = true
  for (const step of Object.values(t.steps)) {
    for (const ch of Object.values(step.channels || {})) if (ch.status === 'pending') Object.assign(ch, { status: 'skipped', error: 'Título pago' })
    if (step.status === 'waiting_call') step.status = 'skipped'
    refreshStep(step)
  }
}

export function titleAction(id, action, body = {}) {
  const t = byId(id)
  if (!t) throw Object.assign(new Error('Título não encontrado.'), { status: 404 })
  switch (action) {
    case 'pago':
      if (t.status === 'paid') throw new ValidationError('O título já está pago.')
      markPaid(t, str(body.note, 200) || 'Marcado como pago')
      break
    case 'reabrir':
      if (t.status === 'open') throw new ValidationError('O título já está em aberto.')
      Object.assign(t, { status: 'open', paidAt: null, paidNote: '' })
      history(t, 'Título reaberto. A régua continua a partir da etapa do dia.')
      break
    case 'pausar':
      t.paused = true
      history(t, 'Régua pausada para este título.', 'warn')
      break
    case 'retomar':
      t.paused = false
      history(t, 'Régua retomada para este título.')
      break
    case 'promessa': {
      const date = parseDateKey(body.date)
      if (!date || date < today()) throw new ValidationError('Informe uma data de pagamento a partir de hoje.')
      t.promise = { date, status: 'active', at: Date.now(), source: 'manual' }
      history(t, `Promessa de pagamento para ${formatDateBR(date)}. Régua suspensa até lá.`, 'success')
      break
    }
    case 'cancelar':
      t.status = 'cancelled'
      history(t, 'Título cancelado (fora da régua).', 'warn')
      for (const task of state.tasks) if (task.titleId === t.id && task.status === 'open') task.status = 'cancelled'
      skipPendingContacts((ct) => ct.ref?.titleId === t.id, 'Título cancelado')
      break
    case 'excluir':
      skipPendingContacts((ct) => ct.ref?.titleId === t.id, 'Título excluído')
      state.titles = state.titles.filter((x) => x.id !== t.id)
      state.tasks = state.tasks.filter((x) => x.titleId !== t.id)
      save(true)
      return null
    default:
      throw Object.assign(new Error('Ação desconhecida.'), { status: 404 })
  }
  save(true)
  return describeTitle(t)
}

// ---- Situação para a tela ---------------------------------------------------------------

function refreshStep(step) {
  if (!step || step.status === 'waiting_call' || step.status === 'skipped') return
  const chans = Object.values(step.channels || {})
  if (!chans.length) return
  if (chans.some((c) => c.status === 'pending')) step.status = 'sending'
  else if (chans.every((c) => c.status === 'skipped')) step.status = 'done'
  else if (chans.some((c) => c.status === 'failed')) step.status = chans.some((c) => c.status === 'sent') ? 'partial' : 'failed'
  else step.status = 'done'
}

/** Título com campos calculados: dias em relação ao vencimento, etapa atual e próxima. */
export function describeTitle(t, day = today()) {
  const diff = daysBetween(t.vencimento, day)
  const done = config.stages.filter((s) => t.steps[s.key])
  const current = done[done.length - 1]
  const next = config.stages.find((s) => s.enabled && s.offset > diff && !t.steps[s.key])
  return {
    ...t,
    vars: undefined,
    history: undefined,
    diff,
    current: current ? { key: current.key, label: stageLabel(current.offset), name: current.name, ...t.steps[current.key] } : null,
    next: t.status === 'open' && next ? { key: next.key, label: stageLabel(next.offset), name: next.name, date: addDays(t.vencimento, next.offset) } : null,
  }
}

export function titleDetail(id) {
  const t = byId(id)
  if (!t) throw Object.assign(new Error('Título não encontrado.'), { status: 404 })
  return {
    ...describeTitle(t),
    vars: t.vars,
    history: t.history,
    timeline: config.stages.map((s) => ({
      key: s.key,
      label: stageLabel(s.offset),
      name: s.name,
      enabled: s.enabled,
      date: addDays(t.vencimento, s.offset),
      step: t.steps[s.key] || null,
    })),
    tasks: state.tasks.filter((task) => task.titleId === id),
  }
}

const FILTERS = {
  open: (t) => t.status === 'open',
  upcoming: (t, d) => t.status === 'open' && d < 0,
  today: (t, d) => t.status === 'open' && d === 0,
  overdue: (t, d) => t.status === 'open' && d > 0,
  promise: (t) => t.status === 'open' && t.promise?.status === 'active',
  paused: (t) => t.status === 'open' && t.paused,
  paid: (t) => t.status === 'paid',
  cancelled: (t) => t.status === 'cancelled',
}

export function listTitles({ status = '', q = '', page = 1, pageSize = 50 }) {
  const day = today()
  const filter = FILTERS[status]
  const query = String(q || '').trim().toLowerCase()
  let items = state.titles
  if (filter) items = items.filter((t) => filter(t, daysBetween(t.vencimento, day)))
  if (query) {
    items = items.filter((t) => [t.nome, t.telefone, t.email, t.numero].some((v) => String(v || '').toLowerCase().includes(query)))
  }
  items = [...items].sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0))
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50))
  const p = Math.max(1, Number(page) || 1)
  return { total: items.length, page: p, pageSize: size, items: items.slice((p - 1) * size, p * size).map((t) => describeTitle(t, day)) }
}

export function dunningStats() {
  const day = today()
  const month = day.slice(0, 7)
  const sum = (list) => list.reduce((acc, t) => acc + (Number(t.valor) || 0), 0)
  const open = state.titles.filter((t) => t.status === 'open')
  const withDiff = open.map((t) => [t, daysBetween(t.vencimento, day)])
  const overdue = withDiff.filter(([, d]) => d > 0).map(([t]) => t)
  const upcoming = withDiff.filter(([, d]) => d >= -7 && d <= 0).map(([t]) => t)
  const paidMonth = state.titles.filter((t) => t.status === 'paid' && t.paidAt && todayKey(tz(), t.paidAt).startsWith(month))
  return {
    today: day,
    open: { count: open.length, total: sum(open) },
    overdue: { count: overdue.length, total: sum(overdue) },
    upcoming: { count: upcoming.length, total: sum(upcoming) },
    paidMonth: { count: paidMonth.length, total: sum(paidMonth) },
    promises: open.filter((t) => t.promise?.status === 'active').length,
    paused: open.filter((t) => t.paused).length,
    tasksOpen: state.tasks.filter((t) => t.status === 'open').length,
    lastRunDate: state.lastRunDate,
    runs: state.runs.slice(0, 10),
    nextRun: nextRunInfo(),
  }
}

function nextRunInfo() {
  if (!config.enabled) return null
  const day = today()
  let candidate = state.lastRunDate === day ? addDays(day, 1) : day
  for (let i = 0; i < 8 && !config.days.includes(weekdayOf(candidate)); i++) candidate = addDays(candidate, 1)
  return { date: candidate, time: config.runAt }
}

// ---- Execução diária --------------------------------------------------------------------

const pick = (list) => list[Math.floor(Math.random() * list.length)]

/**
 * Executa a régua do dia. Para cada título em aberto, roda só a etapa mais recente que ainda
 * não rodou (títulos importados atrasados não recebem várias mensagens de uma vez).
 */
export function runDunning({ manual = false } = {}) {
  const day = today()
  const stages = config.stages.filter((s) => s.enabled)
  const outbox = []
  const summary = { date: day, at: Date.now(), manual, executed: 0, whatsapp: 0, email: 0, internal: 0, calls: 0, skipped: 0, broken: 0 }

  for (const t of state.titles) {
    if (t.status !== 'open' || t.paused) continue
    const diff = daysBetween(t.vencimento, day)

    // Promessa de pagamento: suspende a régua até a data combinada
    if (t.promise?.status === 'active') {
      if (day <= t.promise.date) continue
      t.promise.status = 'broken'
      history(t, `Promessa para ${formatDateBR(t.promise.date)} não cumprida.`, 'warn')
      if (config.promise.brokenEnabled && config.promise.brokenTemplate.trim()) {
        queueWhatsApp(t, config.promise.brokenTemplate, { kind: 'broken' }, day, outbox)
        summary.broken++
        continue // a etapa do dia fica para a próxima execução
      }
    }

    const due = stages.filter((s) => s.offset <= diff && !t.steps[s.key])
    if (!due.length) continue
    const stage = due[due.length - 1]
    for (const old of due.slice(0, -1)) {
      t.steps[old.key] = { status: 'skipped', date: day, note: 'Etapa já tinha passado' }
    }
    const late = diff - stage.offset
    if (late > config.catchupDays) {
      t.steps[stage.key] = { status: 'skipped', date: day, note: `Etapa passou há ${late} dias (limite: ${config.catchupDays})` }
      summary.skipped++
      continue
    }
    executeStage(stage, t, day, outbox, summary)
    summary.executed++
  }

  flushOutbox(outbox, day)
  state.lastRunDate = day
  state.runs.unshift(summary)
  if (state.runs.length > 30) state.runs.length = 30
  save(true)
  return summary
}

function executeStage(stage, t, day, outbox, summary) {
  const step = (t.steps[stage.key] = { status: 'sending', date: day, channels: {} })
  history(t, `${stageLabel(stage.offset)} · ${stage.name}`)
  if (stage.call.enabled) {
    const task = createTask(t, stage, day)
    Object.assign(step, { status: 'waiting_call', taskId: task.id })
    summary.calls++
    return
  }
  dispatchChannels(stage, t, day, outbox, summary)
}

/** Envia os canais da etapa (WhatsApp, e-mail ao cliente, e-mail interno). */
function dispatchChannels(stage, t, day, outbox, summary, { whatsappTemplate, skipWhatsApp = false } = {}) {
  const step = t.steps[stage.key]
  step.status = 'sending'
  step.channels ||= {}
  if (stage.whatsapp.enabled && !skipWhatsApp) {
    if (!t.telefone) step.channels.whatsapp = { status: 'skipped', error: 'Sem telefone' }
    else {
      queueWhatsApp(t, whatsappTemplate ?? pick(stage.whatsapp.variants), { kind: 'stage', stage: stage.key }, day, outbox)
      step.channels.whatsapp = { status: 'pending' }
      if (summary) summary.whatsapp++
    }
  }
  if (stage.email.enabled) {
    if (!t.email) step.channels.email = { status: 'skipped', error: 'Sem e-mail' }
    else {
      step.channels.email = { status: 'pending' }
      queueEmail({ titleId: t.id, stage: stage.key, channel: 'email' })
      if (summary) summary.email++
    }
  }
  if (stage.internal.enabled) {
    if (!stage.internal.to) step.channels.internal = { status: 'skipped', error: 'Sem destinatário configurado' }
    else {
      step.channels.internal = { status: 'pending' }
      queueEmail({ titleId: t.id, stage: stage.key, channel: 'internal' })
      if (summary) summary.internal++
    }
  }
  refreshStep(step)
}

function queueWhatsApp(t, template, ref, day, outbox) {
  outbox.push({ number: t.telefone, raw: t.telefoneRaw, vars: titleVars(t, day), template, ref: { titleId: t.id, ...ref } })
}

/** Junta os envios na campanha interna do dia (cria se não existir). */
function flushOutbox(outbox, day) {
  if (!outbox.length) return
  let c = listCampaigns().find((x) => x.source?.type === 'regua' && x.source.date === day)
  if (!c) {
    c = createSystemCampaign({
      name: `Régua de cobrança — ${formatDateBR(day)}`,
      settings: { ...config.sending, validateNumbers: false, linkPreview: false, timeZone: config.timeZone },
      source: { type: 'regua', date: day },
      headers: ['nome', 'telefone', 'valor', 'vencimento', 'dias_atraso'],
    })
  }
  appendToCampaign(c, outbox)
}

// Resultado de cada WhatsApp enviado pela campanha interna
onContactProcessed((c, ct) => {
  if (c.source?.type !== 'regua' || !ct.ref) return
  const t = byId(ct.ref.titleId)
  if (!t) return
  const ok = ct.status === 'sent'
  const result = { status: ok ? 'sent' : 'failed', at: Date.now(), error: ok ? null : ct.error }
  if (ct.ref.kind === 'stage') {
    const step = t.steps[ct.ref.stage]
    if (step) {
      step.channels ||= {}
      step.channels.whatsapp = result
      refreshStep(step)
    }
    const stage = stageByKey(ct.ref.stage)
    history(t, `WhatsApp ${stage ? stageLabel(stage.offset) : ''} ${ok ? 'enviado' : `falhou: ${ct.error}`}`, ok ? 'success' : 'error')
  } else {
    const what = ct.ref.kind === 'confirm' ? 'Confirmação da promessa' : 'Aviso de promessa não cumprida'
    history(t, `${what} ${ok ? 'enviada' : `falhou: ${ct.error}`} (WhatsApp)`, ok ? 'success' : 'error')
  }
  save()
})

// ---- Tarefas de ligação -----------------------------------------------------------------

function createTask(t, stage, day) {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = config.callCutoff.split(':').map(Number)
  const cutoff = zonedToUtc(y, m, d, h, mi, tz())
  const task = {
    id: crypto.randomUUID(),
    titleId: t.id,
    stage: stage.key,
    date: day,
    // Criada depois do horário limite (execução manual à tarde): 2 h para a equipe ligar
    cutoffAt: cutoff > Date.now() ? cutoff : Date.now() + 2 * 3600_000,
    attempts: Object.fromEntries(stage.call.attempts.map((a) => [a, false])),
    status: 'open',
    result: null,
    promiseDate: null,
    note: '',
    createdAt: Date.now(),
    resolvedAt: null,
  }
  state.tasks.push(task)
  return task
}

export function listTasks({ status = 'open' } = {}) {
  const day = today()
  return state.tasks
    .filter((task) => (status === 'all' ? true : task.status === status))
    .sort((a, b) => a.cutoffAt - b.cutoffAt)
    .slice(0, 500)
    .map((task) => {
      const t = byId(task.titleId)
      const stage = stageByKey(task.stage)
      return {
        ...task,
        stageLabel: stage ? stageLabel(stage.offset) : task.stage,
        stageName: stage?.name || '',
        objective: stage?.objective || '',
        title: t ? describeTitle(t, day) : null,
      }
    })
}

/**
 * Resultado da ligação. Promessa: registra a data, envia a confirmação e o e-mail da etapa.
 * Sem acordo / não atendeu / sem registro: envia a mensagem e o e-mail da etapa.
 */
export function resolveTask(id, { result, promiseDate, attempts = {}, note = '' }, { auto = false } = {}) {
  const task = state.tasks.find((x) => x.id === id)
  if (!task) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 })
  if (task.status !== 'open') throw new ValidationError('Esta tarefa já foi resolvida.')
  if (!CALL_RESULTS[result]) throw new ValidationError('Resultado da ligação inválido.')
  const t = byId(task.titleId)
  const stage = stageByKey(task.stage)
  const day = today()
  let date = null
  if (result === 'promise') {
    date = parseDateKey(promiseDate)
    if (!date || date < day) throw new ValidationError('Informe a data prometida (a partir de hoje).')
  }

  for (const key of Object.keys(task.attempts)) if (attempts[key] !== undefined) task.attempts[key] = Boolean(attempts[key])
  Object.assign(task, { status: auto ? 'expired' : 'done', result, promiseDate: date, note: str(note, 500), resolvedAt: Date.now() })
  if (!t || !stage || t.status !== 'open') {
    save(true)
    return task
  }

  const step = (t.steps[stage.key] ||= { status: 'sending', date: day, channels: {} })
  step.call = { result, attempts: task.attempts, at: Date.now(), note: task.note }
  history(t, `Ligação ${stageLabel(stage.offset)}: ${CALL_RESULTS[result]}${date ? ` (${formatDateBR(date)})` : ''}${note ? ` — ${note}` : ''}`, result === 'promise' ? 'success' : 'info')

  const outbox = []
  if (result === 'paid') {
    step.status = 'done'
    markPaid(t, 'Cliente informou o pagamento na ligação')
  } else if (result === 'promise') {
    t.promise = { date, status: 'active', at: Date.now(), source: 'ligacao', stage: stage.key }
    const confirm = config.promise.confirmEnabled && config.promise.confirmTemplate.trim()
    dispatchChannels(stage, t, day, outbox, null, { skipWhatsApp: true })
    if (confirm && t.telefone) queueWhatsApp(t, config.promise.confirmTemplate, { kind: 'confirm' }, day, outbox)
  } else {
    dispatchChannels(stage, t, day, outbox, null)
  }
  flushOutbox(outbox, day)
  save(true)
  return task
}

function expireTasks(now = Date.now()) {
  for (const task of state.tasks) {
    if (task.status === 'open' && task.cutoffAt <= now) {
      try {
        resolveTask(task.id, { result: 'expired' }, { auto: true })
      } catch (err) {
        console.error('Erro ao expirar tarefa da régua:', err)
      }
    }
  }
}

// ---- E-mails ----------------------------------------------------------------------------

const mailQueue = []
let mailing = false

function queueEmail(job) {
  mailQueue.push(job)
  if (!mailing) drainMail()
}

async function drainMail() {
  mailing = true
  while (mailQueue.length) {
    const job = mailQueue.shift()
    if (job.cancelled) continue
    await sendEmailJob(job)
    await sleep(1500)
  }
  mailing = false
}

const isPdf = (url) => /^https?:\/\/\S+\.pdf(\?\S*)?$/i.test(String(url || ''))

async function sendEmailJob(job) {
  const t = byId(job.titleId)
  const stage = stageByKey(job.stage)
  const step = t?.steps[job.stage]
  if (!t || !stage || !step) return
  const channel = (step.channels ||= {})[job.channel] || (step.channels[job.channel] = { status: 'pending' })
  const vars = titleVars(t, today())
  try {
    if (job.channel === 'internal') {
      await sendMail({ to: stage.internal.to, subject: renderTemplate(stage.internal.subject, vars), text: renderTemplate(stage.internal.body, vars) })
    } else {
      const attachments =
        stage.email.attachBoleto && isPdf(t.boleto) ? [{ filename: `boleto${t.numero ? `-${t.numero}` : ''}.pdf`, path: t.boleto }] : undefined
      await sendMail({ to: t.email, subject: renderTemplate(stage.email.subject, vars), text: renderTemplate(stage.email.body, vars), attachments })
    }
    Object.assign(channel, { status: 'sent', at: Date.now(), error: null })
    history(t, `${job.channel === 'internal' ? 'E-mail interno' : 'E-mail'} ${stageLabel(stage.offset)} enviado`, 'success')
  } catch (err) {
    Object.assign(channel, { status: 'failed', at: Date.now(), error: err.message })
    history(t, `${job.channel === 'internal' ? 'E-mail interno' : 'E-mail'} ${stageLabel(stage.offset)} falhou: ${err.message}`, 'error')
  }
  refreshStep(step)
  save()
}

/** Reenvia os e-mails que falharam (ex.: depois de corrigir o SMTP). */
export function retryFailedEmails() {
  let count = 0
  for (const t of state.titles) {
    if (t.status !== 'open') continue
    for (const [key, step] of Object.entries(t.steps)) {
      for (const channel of ['email', 'internal']) {
        if (step.channels?.[channel]?.status === 'failed') {
          step.channels[channel] = { status: 'pending' }
          queueEmail({ titleId: t.id, stage: key, channel })
          count++
        }
      }
    }
  }
  save(true)
  return count
}

/** Na inicialização: reenfileira e-mails que estavam pendentes quando o servidor parou. */
function resumePendingEmails() {
  for (const t of state.titles) {
    for (const [key, step] of Object.entries(t.steps)) {
      for (const channel of ['email', 'internal']) {
        if (step.channels?.[channel]?.status === 'pending') queueEmail({ titleId: t.id, stage: key, channel })
      }
    }
  }
}

// ---- Agendador --------------------------------------------------------------------------

function tick() {
  try {
    expireTasks()
    if (!config.enabled) return
    const now = Date.now()
    const day = today()
    if (state.lastRunDate === day || !config.days.includes(weekdayOf(day))) return
    const p = zonedParts(now, tz())
    const [h, m] = config.runAt.split(':').map(Number)
    if (p.h * 60 + p.mi >= h * 60 + m) runDunning()
  } catch (err) {
    console.error('Erro na régua de cobrança:', err)
  }
}

export function startDunning() {
  resumePendingEmails()
  tick()
  setInterval(tick, 30_000).unref()
}

// ---- Exportação ---------------------------------------------------------------------------

export function exportRows() {
  const day = today()
  const labels = { open: 'em aberto', paid: 'pago', cancelled: 'cancelado' }
  return state.titles.map((t) => {
    const d = describeTitle(t, day)
    return {
      numero: t.numero,
      nome: t.nome,
      telefone: t.telefone,
      email: t.email,
      valor: formatMoney(t.valor),
      vencimento: formatDateBR(t.vencimento),
      dias: d.diff > 0 ? `D+${d.diff}` : d.diff === 0 ? 'D0' : `D${d.diff}`,
      status: t.paused && t.status === 'open' ? 'em aberto (régua pausada)' : labels[t.status],
      etapa_atual: d.current ? `${d.current.label} ${d.current.name}` : '',
      proxima_etapa: d.next ? `${d.next.label} ${d.next.name} (${formatDateBR(d.next.date)})` : '',
      promessa: t.promise ? `${formatDateBR(t.promise.date)} (${{ active: 'ativa', broken: 'não cumprida', kept: 'cumprida' }[t.promise.status] || t.promise.status})` : '',
      pago_em: t.paidAt ? new Date(t.paidAt).toLocaleString('pt-BR', { timeZone: tz() }) : '',
    }
  })
}
