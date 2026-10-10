// Criação e execução das campanhas de disparo.
// Um único executor processa uma campanha por vez (várias campanhas em paralelo
// no mesmo número aumentam muito o risco de bloqueio).
import crypto from 'node:crypto'
import { applyFilters, describeFilters } from '../shared/filters.js'
import { prepareContacts } from '../shared/phone.js'
import { renderTemplate } from '../shared/template.js'
import {
  DEFAULT_TIMEZONE,
  describeWindow,
  isValidTimeZone,
  isWithinWindow,
  nextWindowStart,
  normalizeWindow,
} from '../shared/schedule.js'
import { addCampaign, appendLog as log, getCampaign, listCampaigns, readUpload, saveCampaign } from './store.js'
import { checkNumbers, fatalReason, sendMedia, sendMenu, sendText, UazapiError } from './uazapi.js'
import { ValidationError } from './errors.js'
import { flowCounts, interestPayload, normalizeFlow } from './flow.js'

export const MEDIA_TYPES = ['image', 'video', 'document', 'audio', 'ptt']

const DEFAULT_SETTINGS = {
  minDelay: 8, // segundos entre mensagens
  maxDelay: 20,
  batchSize: 50, // mensagens por lote (0 = sem pausa entre lotes)
  batchPause: 5, // minutos de pausa entre lotes
  typingSeconds: 3, // "digitando..." antes de cada mensagem
  validateNumbers: true, // consulta /chat/check antes de enviar
  linkPreview: false,
}

const MAX_CONSECUTIVE_FAILURES = 5

const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (n, min, max, fallback) => (Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Number(n))) : fallback)

export { ValidationError }

const MIN_SCHEDULE_AHEAD = 15_000 // abaixo disso, "agendado" vira "agora"
const MAX_SCHEDULE_AHEAD = 366 * 24 * 3600_000

/** Data/hora legível no fuso da campanha (para o log). */
export function formatWhen(ts, timeZone) {
  return new Date(ts).toLocaleString('pt-BR', {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function validateStartAt(startAt) {
  const ts = Number(startAt)
  if (!Number.isFinite(ts)) throw new ValidationError('Data de agendamento inválida.')
  const now = Date.now()
  if (ts < now - 60_000) throw new ValidationError('A data de agendamento já passou.')
  if (ts > now + MAX_SCHEDULE_AHEAD) throw new ValidationError('Agende para no máximo 1 ano à frente.')
  return ts
}

export function normalizeSettings(input = {}) {
  const d = DEFAULT_SETTINGS
  let window
  try {
    window = normalizeWindow(input.window, input.timeZone)
  } catch (err) {
    throw new ValidationError(err.message)
  }
  const s = {
    minDelay: clamp(input.minDelay, 1, 3600, d.minDelay),
    maxDelay: clamp(input.maxDelay, 1, 3600, d.maxDelay),
    batchSize: Math.round(clamp(input.batchSize, 0, 100_000, d.batchSize)),
    batchPause: clamp(input.batchPause, 0, 24 * 60, d.batchPause),
    typingSeconds: clamp(input.typingSeconds, 0, 30, d.typingSeconds),
    validateNumbers: input.validateNumbers ?? d.validateNumbers,
    linkPreview: input.linkPreview ?? d.linkPreview,
    window,
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : DEFAULT_TIMEZONE,
  }
  if (s.maxDelay < s.minDelay) s.maxDelay = s.minDelay
  s.validateNumbers = Boolean(s.validateNumbers)
  s.linkPreview = Boolean(s.linkPreview)
  return s
}

/** Valida a mídia vinda da tela: { type, url } ou { type, uploadId, fileName, mimetype }. */
export function normalizeMedia(media) {
  if (!media) return null
  if (!MEDIA_TYPES.includes(media.type)) throw new ValidationError('Tipo de mídia inválido.')
  const out = { type: media.type, fileName: String(media.fileName || '').slice(0, 200), mimetype: media.mimetype || '' }
  if (media.uploadId) {
    if (!readUpload(media.uploadId)) throw new ValidationError('Arquivo de mídia não encontrado. Envie o arquivo novamente.')
    out.uploadId = media.uploadId
  } else if (media.url && /^https?:\/\//i.test(media.url)) {
    out.url = media.url.trim()
  } else {
    throw new ValidationError('Informe um arquivo ou uma URL (http/https) para a mídia.')
  }
  return out
}

/**
 * Arquivo no formato que a uazapi espera em `file`: a URL informada, ou o upload como
 * Data URI. O Data URI leva o tipo do arquivo junto, então a API não precisa adivinhá-lo
 * pelo início do base64 — sem isso a mídia pode ser descartada no envio com botões.
 */
function mediaFile(media) {
  if (!media.uploadId) return media.url
  const base64 = readUpload(media.uploadId)
  if (!base64 || /^data:/i.test(base64)) return base64
  // Sem o tipo do navegador, vai o base64 puro: a uazapi reconhece o arquivo pelo início dele
  return media.mimetype ? `data:${media.mimetype};base64,${base64}` : base64
}

/** A uazapi responde 200 mesmo quando o WhatsApp recusou a mensagem: o erro vem no corpo. */
function sendFailure(res) {
  if (!res || typeof res !== 'object') return null
  const error = typeof res.error === 'string' ? res.error.trim() : ''
  if (error) return `A uazapi recusou a mensagem: ${error}`
  if (res.status === 'Failed') return 'A uazapi não conseguiu enviar a mensagem (status "Failed").'
  return null
}

/**
 * Monta o payload e envia uma mensagem (texto, mídia ou botões de interesse).
 * Repete em caso de 429. `flowKey` identifica a campanha nos IDs dos botões.
 */
export async function deliver({ number, template, vars, media, settings, flow, flowKey }) {
  const text = renderTemplate(template, vars)
  const common = {
    number,
    delay: settings.typingSeconds ? Math.round(settings.typingSeconds * 1000) : undefined,
  }

  let file = null
  if (media) {
    file = mediaFile(media)
    if (!file) throw new UazapiError('Arquivo de mídia não encontrado no servidor.', { kind: 'config' })
  }

  let payload
  if (flow) {
    payload = { ...common, ...interestPayload({ flow, key: flowKey, text, file, media }) }
  } else if (media) {
    payload = { ...common, type: media.type, file, text: text || undefined }
    if (media.mimetype) payload.mimetype = media.mimetype
    if (media.type === 'document') payload.docName = media.fileName || 'documento'
  } else {
    payload = { ...common, text, linkPreview: settings.linkPreview || undefined }
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const res = flow ? await sendMenu(payload) : media ? await sendMedia(payload) : await sendText(payload)
      const failure = sendFailure(res)
      if (failure) throw new UazapiError(failure, { data: res })
      return { text, messageId: res?.messageid || res?.id || null }
    } catch (err) {
      // 429 = limite de requisições: a mensagem não foi aceita, então é seguro repetir
      if (err instanceof UazapiError && err.status === 429 && attempt < 5) {
        await sleep((err.retryAfter || 2 ** attempt) * 1000)
        continue
      }
      err.renderedText = text
      throw err
    }
  }
}

export function createCampaign({
  name,
  template = '',
  media,
  settings,
  rows,
  phoneColumn,
  countryCode = '55',
  filters = null,
  flow: flowInput = null,
  startAt = null,
  start = true,
}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new ValidationError('O CSV não possui linhas.')
  if (rows.length > 100_000) throw new ValidationError('Limite de 100.000 contatos por campanha.')
  if (!phoneColumn || !(phoneColumn in rows[0])) throw new ValidationError('Selecione a coluna de telefone.')

  const normalizedMedia = normalizeMedia(media)
  const flow = normalizeFlow(flowInput)
  if (flow) {
    if (!String(template).trim()) throw new ValidationError('Escreva o texto da mensagem com botões.')
    if (normalizedMedia && !['image', 'video', 'document'].includes(normalizedMedia.type)) {
      throw new ValidationError('Mensagens com botões aceitam apenas imagem, vídeo ou documento.')
    }
  } else if (!String(template).trim() && !normalizedMedia) {
    throw new ValidationError('Escreva a mensagem ou anexe uma mídia.')
  }

  const filtered = applyFilters(rows, filters)
  if (!filtered.rows.length) throw new ValidationError('Nenhuma linha do CSV atende aos filtros.')

  const { contacts, stats } = prepareContacts(filtered.rows, phoneColumn, countryCode, filtered.indexes)
  if (stats.valid === 0) throw new ValidationError('Nenhum telefone válido encontrado na coluna selecionada.')

  const now = Date.now()
  const scheduledFor = startAt ? validateStartAt(startAt) : null
  const scheduled = start && scheduledFor && scheduledFor > now + MIN_SCHEDULE_AHEAD
  const id = crypto.randomUUID()
  if (flow) flow.key = id.slice(0, 8)
  const filterText = describeFilters(filters)

  const c = {
    id,
    name: String(name || '').trim().slice(0, 120) || `Disparo ${formatWhen(now, settings?.timeZone)}`,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    queuedAt: start && !scheduled ? now : null,
    status: !start ? 'paused' : scheduled ? 'scheduled' : 'queued',
    startAt: scheduled ? scheduledFor : null,
    scheduledFor: scheduled ? scheduledFor : null,
    scheduleReason: scheduled ? 'start' : null,
    lastError: null,
    nextSendAt: null,
    template: String(template),
    media: normalizedMedia,
    flow,
    filters: filterText ? { ...filters, text: filterText, totalRows: rows.length, keptRows: filtered.rows.length } : null,
    settings: normalizeSettings(settings),
    phoneColumn,
    countryCode,
    headers: Object.keys(rows[0]),
    contacts: contacts.map(({ i, raw, number, vars, status, error }) => ({
      i,
      raw,
      number,
      vars,
      status,
      error,
      jid: null,
      checked: false,
      text: null,
      messageId: null,
      processedAt: null,
    })),
    log: [],
  }

  if (filterText) {
    log(c, 'info', `Filtro aplicado (${filterText}): ${plural(filtered.rows.length, 'linha', 'linhas')} de ${rows.length.toLocaleString('pt-BR')}.`)
  }
  log(
    c,
    'info',
    `Campanha criada: ${plural(stats.valid, 'contato válido', 'contatos válidos')}, ${plural(stats.invalid, 'inválido', 'inválidos')}, ${plural(stats.duplicates, 'duplicado', 'duplicados')}.`,
  )
  const w = c.settings.window
  if (scheduled) log(c, 'info', `Disparo agendado para ${formatWhen(scheduledFor, w.timeZone)}.`)
  if (w.enabled) log(c, 'info', `Janela de envio: ${describeWindow(w)}.`)
  if (start && !scheduled && w.enabled && !isWithinWindow(now, w)) {
    const next = nextWindowStart(now, w)
    Object.assign(c, { status: 'scheduled', queuedAt: null, scheduledFor: next, scheduleReason: 'window' })
    log(c, 'info', `Fora da janela de envio agora. O disparo começa ${formatWhen(next, w.timeZone)}.`)
  }
  addCampaign(c)
  if (c.status === 'queued') kick()
  return c
}

export function countsOf(c) {
  const counts = { total: c.contacts.length, pending: 0, sent: 0, failed: 0, invalid: 0, skipped: 0 }
  for (const ct of c.contacts) counts[ct.status]++
  return counts
}

export function summarize(c) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    createdAt: c.createdAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    lastError: c.lastError,
    nextSendAt: c.nextSendAt,
    pauseReason: c.pauseReason || null,
    startAt: c.startAt || null,
    scheduledFor: c.status === 'scheduled' ? c.scheduledFor : null,
    scheduleReason: c.status === 'scheduled' ? c.scheduleReason : null,
    template: c.template,
    media: c.media ? { type: c.media.type, fileName: c.media.fileName, url: c.media.url || null } : null,
    flow: c.flow || null,
    filters: c.filters || null,
    settings: c.settings,
    counts: countsOf(c),
    flowCounts: c.flow ? flowCounts(c) : null,
  }
}

// ---- Controle ----------------------------------------------------------------

export function pauseCampaign(c) {
  if (!['running', 'queued', 'scheduled'].includes(c.status)) throw new ValidationError('A campanha não está em andamento.')
  c.status = 'paused'
  c.nextSendAt = null
  c.pauseReason = null
  log(c, 'warn', 'Disparo pausado pelo usuário.')
  saveCampaign(c, true)
}

export function resumeCampaign(c) {
  if (c.status !== 'paused') throw new ValidationError('Só é possível retomar uma campanha pausada.')
  if (!c.contacts.some((ct) => ct.status === 'pending')) throw new ValidationError('Não há contatos pendentes.')
  c.lastError = null
  // Campanha agendada que foi pausada antes de começar volta a esperar o horário
  if (!c.startedAt && c.startAt && c.startAt > Date.now()) {
    Object.assign(c, { status: 'scheduled', scheduledFor: c.startAt, scheduleReason: 'start' })
    log(c, 'info', `Agendamento reativado para ${formatWhen(c.startAt, c.settings.window?.timeZone)}.`)
    saveCampaign(c, true)
    return
  }
  c.status = 'queued'
  c.queuedAt = Date.now()
  saveCampaign(c, true)
  kick()
}

/** Começa uma campanha agendada imediatamente (a janela de envio continua valendo). */
export function startNow(c) {
  if (c.status !== 'scheduled') throw new ValidationError('A campanha não está agendada.')
  log(c, 'info', 'Início antecipado pelo usuário.')
  Object.assign(c, { status: 'queued', queuedAt: Date.now(), scheduledFor: null, scheduleReason: null })
  if (!c.startedAt) c.startAt = null
  saveCampaign(c, true)
  kick()
}

export function reschedule(c, startAt) {
  if (!['scheduled', 'paused'].includes(c.status)) throw new ValidationError('Só é possível reagendar campanhas agendadas ou pausadas.')
  if (!c.contacts.some((ct) => ct.status === 'pending')) throw new ValidationError('Não há contatos pendentes.')
  const ts = validateStartAt(startAt)
  Object.assign(c, { status: 'scheduled', scheduledFor: ts, scheduleReason: 'start', lastError: null })
  if (!c.startedAt) c.startAt = ts
  log(c, 'info', `Disparo reagendado para ${formatWhen(ts, c.settings.window?.timeZone)}.`)
  saveCampaign(c, true)
}

export function cancelCampaign(c) {
  if (['completed', 'cancelled'].includes(c.status)) throw new ValidationError('A campanha já foi finalizada.')
  c.status = 'cancelled'
  c.finishedAt = Date.now()
  c.nextSendAt = null
  c.pauseReason = null
  log(c, 'warn', 'Disparo cancelado pelo usuário.')
  saveCampaign(c, true)
}

export function retryFailed(c) {
  if (c.status === 'running' || c.status === 'queued') throw new ValidationError('Aguarde a campanha terminar ou pause-a antes.')
  const failed = c.contacts.filter((ct) => ct.status === 'failed')
  if (!failed.length) throw new ValidationError('Não há envios com falha.')
  for (const ct of failed) Object.assign(ct, { status: 'pending', error: null, processedAt: null })
  log(c, 'info', `${plural(failed.length, 'contato com falha voltou', 'contatos com falha voltaram')} para a fila.`)
  c.status = 'queued'
  c.queuedAt = Date.now()
  c.finishedAt = null
  c.lastError = null
  saveCampaign(c, true)
  kick()
}

// ---- Executor -----------------------------------------------------------------

let activeId = null
let shuttingDown = false
let inFlight = null // envio em andamento (aguardado no desligamento)
let lastSendAt = 0 // global: o intervalo vale entre campanhas, pois o número é o mesmo

/** Coloca na fila as campanhas cujo horário agendado (ou abertura da janela) chegou. */
function releaseScheduled() {
  const now = Date.now()
  let released = false
  for (const c of listCampaigns()) {
    if (c.status !== 'scheduled' || !c.scheduledFor || c.scheduledFor > now) continue
    const started = countsOf(c).sent > 0
    c.startNote =
      c.scheduleReason === 'window'
        ? `Janela de envio aberta. ${started ? 'Retomando' : 'Iniciando'} o disparo.`
        : 'Horário agendado atingido. Iniciando o disparo.'
    Object.assign(c, { status: 'queued', queuedAt: c.scheduledFor, scheduledFor: null, scheduleReason: null })
    saveCampaign(c, true)
    released = true
  }
  if (released) kick()
}

export function startScheduler() {
  releaseScheduled()
  setInterval(releaseScheduled, 5000).unref()
}

export function kick() {
  if (activeId || shuttingDown) return
  const next = listCampaigns()
    .filter((c) => c.status === 'queued')
    .sort((a, b) => a.queuedAt - b.queuedAt)[0]
  if (!next) return

  activeId = next.id
  run(next).finally(() => {
    activeId = null
    setImmediate(kick)
  })
}

class StopCampaign extends Error {}

async function run(c) {
  c.status = 'running'
  c.startedAt ??= Date.now()
  c.batchCount = 0
  log(c, 'info', c.startNote || (countsOf(c).sent ? 'Disparo retomado.' : 'Disparo iniciado.'))
  delete c.startNote
  saveCampaign(c, true)

  try {
    if (c.settings.validateNumbers) await validateNumbers(c)
    await sendAll(c)
    if (shuttingDown) return
    if (c.status === 'running') {
      c.status = 'completed'
      c.finishedAt = Date.now()
      const n = countsOf(c)
      log(c, 'success', `Disparo concluído: ${plural(n.sent, 'enviada', 'enviadas')}, ${plural(n.failed, 'falha', 'falhas')}.`)
    }
  } catch (err) {
    if (c.status === 'running') {
      c.status = 'paused'
      c.lastError = err.message
      log(c, 'error', `Disparo pausado: ${err.message}`)
    }
    if (!(err instanceof StopCampaign)) console.error(`[${c.id}]`, err)
  } finally {
    c.nextSendAt = null
    c.pauseReason = null
    if (getCampaign(c.id)) saveCampaign(c, true)
  }
}

/** Espera `ms`, mas retorna antes (false) se a campanha deixar de rodar ou o servidor for desligar. */
async function wait(c, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (c.status !== 'running' || shuttingDown) return false
    await sleep(Math.min(500, end - Date.now()))
  }
  return c.status === 'running' && !shuttingDown
}

/**
 * Desligamento gracioso (SIGTERM do Railway em um novo deploy): não inicia novos envios,
 * espera o envio em andamento (até 10 s) e marca as campanhas ativas para retomar sozinhas.
 */
export async function shutdownRunner() {
  shuttingDown = true
  if (inFlight) await Promise.race([inFlight.catch(() => {}), sleep(10_000)])
  for (const c of listCampaigns()) {
    if (c.status === 'running' || c.status === 'queued') {
      c.resumeAfterRestart = true
      saveCampaign(c, true)
    }
  }
}

const randomDelay = ({ minDelay, maxDelay }) => Math.round((minDelay + Math.random() * (maxDelay - minDelay)) * 1000)

async function sendAll(c) {
  let consecutiveFailures = 0

  for (const ct of c.contacts) {
    if (c.status !== 'running' || shuttingDown) return
    if (ct.status !== 'pending') continue

    // Pausa entre lotes
    if (c.settings.batchSize > 0 && c.batchCount >= c.settings.batchSize && c.settings.batchPause > 0) {
      const ms = c.settings.batchPause * 60_000
      log(c, 'info', `Lote de ${c.batchCount} mensagens concluído. Pausa de ${c.settings.batchPause} min.`)
      c.nextSendAt = Date.now() + ms
      c.pauseReason = 'batch'
      saveCampaign(c)
      if (!(await wait(c, ms))) return
      c.batchCount = 0
      c.pauseReason = null
    }

    // Intervalo aleatório desde o último envio
    if (lastSendAt) {
      const ms = Math.max(0, lastSendAt + randomDelay(c.settings) - Date.now())
      c.nextSendAt = Date.now() + ms
      saveCampaign(c)
      if (!(await wait(c, ms))) return
    }
    c.nextSendAt = null

    // Fora da janela de envio: libera o executor e agenda a retomada
    const w = c.settings.window
    if (w?.enabled && !isWithinWindow(Date.now(), w)) {
      const next = nextWindowStart(Date.now(), w)
      if (!next) throw new StopCampaign('Não foi possível calcular a próxima janela de envio.')
      Object.assign(c, { status: 'scheduled', scheduledFor: next, scheduleReason: 'window', batchCount: 0 })
      log(c, 'info', `Fora da janela de envio (${describeWindow(w)}). Retoma em ${formatWhen(next, w.timeZone)}.`)
      return
    }

    if (shuttingDown) return
    try {
      inFlight = deliver({
        number: ct.jid || ct.number,
        template: c.template,
        vars: ct.vars,
        media: c.media,
        settings: c.settings,
        flow: c.flow,
        flowKey: c.flow?.key,
      })
      const { text, messageId } = await inFlight
      Object.assign(ct, { status: 'sent', text, messageId, error: null, processedAt: Date.now() })
      consecutiveFailures = 0
      log(c, 'success', `Enviado para ${ct.number}`)
    } catch (err) {
      const fatal = fatalReason(err)
      if (fatal) throw new StopCampaign(fatal) // contato continua pendente

      Object.assign(ct, { status: 'failed', text: err.renderedText ?? null, error: err.message, processedAt: Date.now() })
      consecutiveFailures++
      log(c, 'error', `Falha para ${ct.number}: ${err.message}`)
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new StopCampaign(`${MAX_CONSECUTIVE_FAILURES} falhas seguidas. Verifique a instância e retome o disparo.`)
      }
    } finally {
      inFlight = null
    }

    lastSendAt = Date.now()
    c.batchCount++
    saveCampaign(c)
  }
}

/** Marca como inválidos os números que não têm WhatsApp e guarda o JID dos demais. */
async function validateNumbers(c) {
  const pending = c.contacts.filter((ct) => ct.status === 'pending' && !ct.checked && !ct.number.includes('@'))
  if (!pending.length) return

  log(c, 'info', `Verificando ${plural(pending.length, 'número', 'números')} no WhatsApp…`)
  saveCampaign(c)
  let notFound = 0

  for (let i = 0; i < pending.length; i += 50) {
    if (c.status !== 'running' || shuttingDown) return
    const chunk = pending.slice(i, i + 50)

    let result
    try {
      result = await checkNumbers(chunk.map((ct) => ct.number))
    } catch (err) {
      const fatal = fatalReason(err)
      if (fatal) throw new StopCampaign(fatal)
      log(c, 'warn', `Não foi possível verificar os números (${err.message}). Seguindo sem verificação.`)
      return
    }

    const list = Array.isArray(result) ? result : []
    chunk.forEach((ct, k) => {
      const r = list.find((x) => x?.query === ct.number) ?? list[k]
      ct.checked = true
      if (!r) return
      if (r.isInWhatsapp === false) {
        Object.assign(ct, { status: 'invalid', error: 'Número sem WhatsApp', processedAt: Date.now() })
        notFound++
      } else if (r.jid) {
        ct.jid = r.jid
      }
    })
    saveCampaign(c)
    await sleep(300)
  }

  log(
    c,
    notFound ? 'warn' : 'info',
    notFound
      ? `Verificação concluída: ${plural(notFound, 'número sem WhatsApp será ignorado', 'números sem WhatsApp serão ignorados')}.`
      : 'Verificação concluída: todos os números têm WhatsApp.',
  )
}
