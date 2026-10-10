// Fluxo de qualificação: mensagem com botões "Tenho interesse / Não tenho interesse",
// pergunta de faturamento para quem tem interesse, confirmação dos dados do lead
// qualificado e resposta final automática.
import crypto from 'node:crypto'
import { renderTemplate } from '../shared/template.js'
import {
  buildLeadPayload,
  cleanKey,
  dataVars,
  FIELD_TYPES,
  prefillValue,
  summaryText,
  validateField,
  WHATSAPP_COLUMN,
} from '../shared/datafields.js'
import { ValidationError } from './errors.js'
import { appendLog, listCampaigns, saveCampaign } from './store.js'
import { sendMenu, sendText } from './uazapi.js'

// i = interesse · r = faixa de faturamento · c = confirmar (1) / alterar (0) dados
const BUTTON_ID_RE = /^dsp:([a-z0-9]+):(i|r|c):(\d+)$/
const TEST_SESSION_TTL = 24 * 3600_000
const TYPED_REPLY_WINDOW = 15 * 24 * 3600_000 // respostas digitadas só valem para campanhas recentes
const REPLY_GAP_MS = 1200

export const buttonId = (key, kind, value) => `dsp:${key}:${kind}:${value}`

const cleanLabel = (s, max) =>
  String(s ?? '')
    .replace(/[|\r\n]+/g, ' ')
    .trim()
    .slice(0, max)

/** Valida a configuração vinda da tela. Retorna null quando o fluxo está desligado. */
export function normalizeFlow(input) {
  if (!input?.enabled) return null
  const options = (input.options || [])
    .map((o) => ({ label: cleanLabel(o.label, 24), qualified: Boolean(o.qualified) }))
    .filter((o) => o.label)
  if (options.length < 2) throw new ValidationError('Informe pelo menos 2 faixas de faturamento.')
  if (options.length > 10) throw new ValidationError('Use no máximo 10 faixas de faturamento.')

  const yes = cleanLabel(input.buttons?.yes, 20)
  const no = cleanLabel(input.buttons?.no, 20)
  if (!yes || !no) throw new ValidationError('Preencha o texto dos dois botões.')
  const question = String(input.question || '').trim()
  if (!question) throw new ValidationError('Escreva a pergunta de faturamento.')

  return {
    enabled: true,
    buttons: { yes, no },
    footer: cleanLabel(input.footer, 60),
    question,
    listButton: cleanLabel(input.listButton, 20) || 'Ver opções',
    options,
    dataStep: normalizeDataStep(input.dataStep),
    webhook: normalizeWebhook(input.webhook),
    replies: {
      qualified: String(input.replies?.qualified || '').trim(),
      notQualified: String(input.replies?.notQualified || '').trim(),
      noInterest: String(input.replies?.noInterest || '').trim(),
    },
  }
}

const TYPES = new Set(FIELD_TYPES.map((t) => t.value))

function normalizeDataStep(input) {
  if (!input?.enabled) return null
  const fields = (input.fields || [])
    .map((f) => ({
      label: cleanLabel(f.label, 30),
      column: String(f.column || '').slice(0, 200),
      type: TYPES.has(f.type) ? f.type : 'text',
      question: String(f.question || '').trim(),
    }))
    .filter((f) => f.label)
  if (!fields.length) throw new ValidationError('Adicione pelo menos um campo na confirmação de dados.')
  if (fields.length > 8) throw new ValidationError('Use no máximo 8 campos na confirmação de dados.')
  const noQuestion = fields.find((f) => !f.question)
  if (noQuestion) throw new ValidationError(`Escreva a pergunta do campo "${noQuestion.label}".`)
  const confirmLabel = cleanLabel(input.confirmLabel, 20)
  const editLabel = cleanLabel(input.editLabel, 20)
  if (!confirmLabel || !editLabel) throw new ValidationError('Preencha o texto dos botões de confirmação de dados.')
  return {
    enabled: true,
    intro: String(input.intro || '').trim() || 'Confirme seus dados:',
    collectIntro: String(input.collectIntro || '').trim(),
    editIntro: String(input.editIntro || '').trim(),
    confirmLabel,
    editLabel,
    fields,
  }
}

/** URL do webhook de leads qualificados (ex.: webhook de entrada do Clint). */
export function normalizeWebhookUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return ''
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationError('URL do webhook inválida.')
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new ValidationError('O webhook precisa começar com http:// ou https://.')
  return parsed.toString()
}

/** Webhook: URL + tabela chave → valor (com variáveis). Retorna null sem URL. */
export function normalizeWebhook(input) {
  const url = normalizeWebhookUrl(input?.url)
  if (!url) return null
  const fields = (input.fields || [])
    .map((f) => ({ key: cleanKey(f.key), value: String(f.value ?? '').slice(0, 1000) }))
    .filter((f) => f.key)
  const includeSheet = Boolean(input.includeSheet)
  if (!fields.length && !includeSheet) throw new ValidationError('Adicione pelo menos um dado para enviar ao webhook.')
  if (fields.length > 40) throw new ValidationError('Use no máximo 40 dados no webhook.')
  return { url, includeSheet, fields }
}

/** Payload do /send/menu com os botões de interesse (a mídia vai no cabeçalho). */
export function interestPayload({ flow, key, text, file, media }) {
  const payload = {
    type: 'button',
    text,
    choices: [`${flow.buttons.yes}|${buttonId(key, 'i', 1)}`, `${flow.buttons.no}|${buttonId(key, 'i', 0)}`],
  }
  if (flow.footer) payload.footerText = flow.footer
  if (file) {
    payload.file = file
    // Sem `mimetype` a uazapi tenta adivinhar o tipo do cabeçalho (e descarta a mídia em silêncio
    // quando não consegue). `image`, `video` e `document` são valores aceitos pela API.
    payload.mimetype = media.mimetype || media.type
    if (media.type === 'document') payload.docName = media.fileName || 'documento'
  }
  return payload
}

function questionPayload(flow, key, vars) {
  const text = renderTemplate(flow.question, vars)
  const choices = flow.options.map((o, i) => `${o.label}|${buttonId(key, 'r', i)}`)
  // Até 3 opções cabem em botões; acima disso, lista
  if (choices.length <= 3) return { type: 'button', text, choices, ...(flow.footer ? { footerText: flow.footer } : {}) }
  return { type: 'list', text, listButton: flow.listButton, choices: ['[Faturamento]', ...choices] }
}

// ---- Contextos: campanhas com fluxo + sessões de teste ---------------------------------

const testSessions = new Map()

/** O envio de teste cria uma sessão temporária para o fluxo funcionar no seu próprio número. */
export function createTestSession({ flow, vars, number }) {
  const key = `t${crypto.randomBytes(4).toString('hex').slice(0, 7)}`
  const now = Date.now()
  for (const [k, s] of testSessions) if (now - s.createdAt > TEST_SESSION_TTL) testSessions.delete(k)
  const session = {
    key,
    flow,
    createdAt: now,
    isTest: true,
    contacts: [{ i: 0, number, jid: null, vars, status: 'sent', messageId: null }],
    log: [],
  }
  testSessions.set(key, session)
  return session
}

function contexts() {
  const list = [...testSessions.values()]
  for (const c of listCampaigns()) if (c.flow) list.push(c)
  return list
}

const contextByKey = (key) => (key.startsWith('t') ? testSessions.get(key) : listCampaigns().find((c) => c.flow?.key === key))

function persist(ctx) {
  if (!ctx.isTest) saveCampaign(ctx)
}

function log(ctx, level, text) {
  appendLog(ctx, level, text)
}

// ---- Identificação do contato ----------------------------------------------------------

function jidDigits(jid) {
  const value = String(jid || '')
  if (!value || /@(lid|g\.us|newsletter|broadcast)$/.test(value)) return null
  const user = value.split('@')[0].split(':')[0]
  return /^\d{8,15}$/.test(user) ? user : null
}

/** Números do Brasil podem chegar com ou sem o nono dígito. */
function phoneKeys(digits) {
  if (!digits) return []
  if (/^55\d{2}9\d{8}$/.test(digits)) return [digits, digits.slice(0, 4) + digits.slice(5)]
  if (/^55\d{2}\d{8}$/.test(digits)) return [digits, `${digits.slice(0, 4)}9${digits.slice(4)}`]
  return [digits]
}

function contactKeys(ct) {
  return new Set([...phoneKeys(jidDigits(ct.number) || ct.number), ...phoneKeys(jidDigits(ct.jid))])
}

function findByPhone(ctx, phones) {
  if (!phones.length) return null
  const wanted = new Set(phones.flatMap(phoneKeys))
  return ctx.contacts.find((ct) => ct.status === 'sent' && [...contactKeys(ct)].some((k) => wanted.has(k))) || null
}

const stripOwner = (id) => String(id || '').split(':').pop()

function findByMessageId(ctx, quoted) {
  if (!quoted) return null
  const id = stripOwner(quoted)
  return ctx.contacts.find((ct) => stripOwner(ct.messageId) === id || ct.flow?.msgIds?.includes(id)) || null
}

/** Em que ponto do fluxo o contato está. */
function stageOf(ct, flow) {
  const f = ct.flow || {}
  if (!f.interest) return 'interest'
  if (f.interest === 'yes' && f.revenueIndex == null) return 'revenue'
  if (f.qualified && flow.dataStep && f.dataStarted && !f.dataConfirmed) return f.editQueue?.length ? 'edit' : 'confirm'
  return 'done'
}

// ---- Interpretação da mensagem recebida ------------------------------------------------

const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

function extractMessage(evt) {
  if (!evt || typeof evt !== 'object') return null
  const type = String(evt.EventType || evt.type || evt.event || '').toLowerCase()
  if (type && !type.startsWith('message')) return null
  if (type === 'messages_update') return null
  const msg = evt.message || evt.data?.message || (evt.data && typeof evt.data === 'object' ? evt.data : null)
  return msg && typeof msg === 'object' ? { msg, chat: evt.chat || evt.data?.chat || {} } : null
}

function selectedId(msg) {
  if (msg.buttonOrListid) return String(msg.buttonOrListid)
  let content = msg.content
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content)
    } catch {
      content = null
    }
  }
  const c = content || {}
  return (
    c.selectedButtonId ||
    c.selectedId ||
    c.singleSelectReply?.selectedRowId ||
    c.selectedRowId ||
    c.nativeFlowResponseMessage?.paramsJson?.match?.(/"id"\s*:\s*"([^"]+)"/)?.[1] ||
    ''
  )
}

/** Converte resposta digitada ("1", "sim", texto do botão) para a ação correspondente. */
function typedAnswer(ctx, ct, text) {
  const t = normalize(text)
  const stage = stageOf(ct, ctx.flow)
  // Coletando um dado: qualquer texto é a resposta do campo
  if (stage === 'edit') return String(text).trim() ? { kind: 'e', value: String(text).trim() } : null
  if (!t) return null
  if (stage === 'confirm') {
    const ds = ctx.flow.dataStep
    if (['1', 'sim', 'confirmar', 'confirmo', 'confirmado', 'ok', 'certo', 'correto', normalize(ds.confirmLabel)].includes(t)) {
      return { kind: 'c', value: 1 }
    }
    if (['2', 'alterar', 'mudar', 'corrigir', 'nao', normalize(ds.editLabel)].includes(t)) return { kind: 'c', value: 0 }
    return null
  }
  if (stage === 'revenue') {
    const n = Number(t)
    if (Number.isInteger(n) && n >= 1 && n <= ctx.flow.options.length) return { kind: 'r', value: n - 1 }
    const idx = ctx.flow.options.findIndex((o) => normalize(o.label) === t)
    if (idx >= 0) return { kind: 'r', value: idx }
  }
  if (stage === 'interest' || stage === 'revenue') {
    if (t === normalize(ctx.flow.buttons.yes)) return { kind: 'i', value: 1 }
    if (t === normalize(ctx.flow.buttons.no)) return { kind: 'i', value: 0 }
  }
  if (stage === 'interest') {
    if (['1', 'sim', 's', 'tenho interesse', 'quero', 'tenho'].includes(t)) return { kind: 'i', value: 1 }
    if (['2', 'nao', 'n', 'nao tenho interesse', 'nao quero'].includes(t)) return { kind: 'i', value: 0 }
  }
  return null
}

// ---- Envio das respostas automáticas (fila serial) -------------------------------------

let replyQueue = Promise.resolve()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function enqueueReply(ctx, ct, to, label, build) {
  replyQueue = replyQueue
    .then(async () => {
      const { send, payload } = build()
      const res = await send({ number: to, delay: 1500, ...payload })
      const id = res?.messageid || stripOwner(res?.id)
      if (id) (ct.flow.msgIds ||= []).push(id)
      persist(ctx)
    })
    .catch((err) => {
      log(ctx, 'error', `Falha ao enviar ${label} para ${ct.number}: ${err.message}`)
      persist(ctx)
    })
    .then(() => sleep(REPLY_GAP_MS))
}

function applyInterest(ctx, ct, yes, to) {
  const f = (ct.flow ||= {})
  const now = Date.now()
  if (yes) {
    if (f.interest !== 'yes') log(ctx, 'success', `${ct.number} clicou em "${ctx.flow.buttons.yes}".`)
    f.interest = 'yes'
    f.interestAt ??= now
    if (f.revenueIndex == null && !f.askedAt) {
      f.askedAt = now
      enqueueReply(ctx, ct, to, 'a pergunta de faturamento', () => ({
        send: sendMenu,
        payload: questionPayload(ctx.flow, ctx.isTest ? ctx.key : ctx.flow.key, ct.vars),
      }))
    }
  } else {
    if (f.interest === 'no') return
    f.interest = 'no'
    f.interestAt = now
    log(ctx, 'info', `${ct.number} clicou em "${ctx.flow.buttons.no}".`)
    if (ctx.flow.replies.noInterest && !f.noInterestReplied) {
      f.noInterestReplied = true
      enqueueReply(ctx, ct, to, 'a resposta de sem interesse', () => ({
        send: sendText,
        payload: { text: renderTemplate(ctx.flow.replies.noInterest, ct.vars) },
      }))
    }
  }
}

/** Registra a faixa de faturamento. Vale a primeira resposta: retorna false se já havia uma. */
function applyRevenue(ctx, ct, index, to) {
  const option = ctx.flow.options[index]
  if (!option) return false
  const f = (ct.flow ||= {})
  if (f.revenueIndex != null) {
    if (f.revenueIndex !== index) {
      log(ctx, 'warn', `${ct.number} tentou trocar a faixa para "${option.label}" — mantida a primeira resposta ("${f.revenueLabel}").`)
    }
    return false
  }
  f.interest = 'yes'
  f.interestAt ??= Date.now()
  f.revenueIndex = index
  f.revenueLabel = option.label
  f.qualified = option.qualified
  f.revenueAt = Date.now()
  log(ctx, option.qualified ? 'success' : 'info', `${ct.number} informou faturamento "${option.label}"${option.qualified ? ' — qualificado' : ' — não qualificado'}.`)

  if (option.qualified && ctx.flow.dataStep) {
    startDataStep(ctx, ct, to)
    return true
  }
  if (option.qualified) queueLeadWebhook(ctx, ct)

  const reply = option.qualified ? ctx.flow.replies.qualified : ctx.flow.replies.notQualified
  if (reply && !f.finalReplied) {
    f.finalReplied = true
    enqueueReply(ctx, ct, to, 'a resposta final', () => ({ send: sendText, payload: { text: renderTemplate(reply, ct.vars) } }))
  }
  return true
}

// ---- Confirmação de dados (leads qualificados) -----------------------------------------

const flowKeyOf = (ctx) => (ctx.isTest ? ctx.key : ctx.flow.key)

function sendSummary(ctx, ct, to) {
  const ds = ctx.flow.dataStep
  const f = ct.flow
  f.summaryAt = Date.now()
  enqueueReply(ctx, ct, to, 'o resumo dos dados', () => ({
    send: sendMenu,
    payload: {
      type: 'button',
      text: summaryText(renderTemplate(ds.intro, ct.vars), ds.fields, f.data),
      choices: [`${ds.confirmLabel}|${buttonId(flowKeyOf(ctx), 'c', 1)}`, `${ds.editLabel}|${buttonId(flowKeyOf(ctx), 'c', 0)}`],
    },
  }))
}

function askNextField(ctx, ct, to, prefix = '') {
  const field = ctx.flow.dataStep.fields[ct.flow.editQueue[0]]
  const question = renderTemplate(field.question, ct.vars)
  enqueueReply(ctx, ct, to, `a pergunta "${field.label}"`, () => ({
    send: sendText,
    payload: { text: prefix ? `${prefix}\n\n${question}` : question },
  }))
}

/** Preenche os dados com o CSV; pergunta o que faltar e depois mostra o resumo. */
function startDataStep(ctx, ct, to) {
  const ds = ctx.flow.dataStep
  const f = ct.flow
  f.dataStarted = true
  // O telefone vem do número normalizado do CSV (o JID do WhatsApp pode vir sem o nono dígito)
  f.data = ds.fields.map((field) => prefillValue(field, ct.vars, field.column === WHATSAPP_COLUMN ? ct.number : ''))
  f.dataPrefill = [...f.data]
  f.editQueue = f.data.map((v, i) => (v ? null : i)).filter((i) => i !== null)
  if (f.editQueue.length) askNextField(ctx, ct, to, renderTemplate(ds.collectIntro, ct.vars))
  else sendSummary(ctx, ct, to)
}

/** Resposta digitada para o campo em coleta. Retorna o texto da nota para o histórico. */
function applyFieldAnswer(ctx, ct, text, to) {
  const ds = ctx.flow.dataStep
  const f = ct.flow
  const index = f.editQueue[0]
  const field = ds.fields[index]
  const check = validateField(field.type, text)
  if (!check.ok) {
    enqueueReply(ctx, ct, to, 'o aviso de dado inválido', () => ({
      send: sendText,
      payload: { text: field.type === 'text' ? `${check.error} ${renderTemplate(field.question, ct.vars)}` : check.error },
    }))
    return `${field.label} inválido — pedido novamente`
  }
  f.data[index] = check.value
  f.editQueue.shift()
  if (f.editQueue.length) askNextField(ctx, ct, to)
  else sendSummary(ctx, ct, to)
  return `${field.label}: ${check.value}`
}

function applyConfirmation(ctx, ct, confirm, to) {
  const ds = ctx.flow.dataStep
  const f = ct.flow
  const stage = stageOf(ct, ctx.flow)
  if (!ds || (stage !== 'confirm' && stage !== 'edit')) return 'Ignorado (dados já confirmados ou etapa não iniciada)'

  if (!confirm) {
    f.editQueue = ds.fields.map((_, i) => i)
    log(ctx, 'info', `${ct.number} pediu para alterar os dados.`)
    askNextField(ctx, ct, to, renderTemplate(ds.editIntro, ct.vars))
    return 'Alterar dados'
  }
  if (stage === 'edit') return 'Confirmação ignorada (ainda respondendo os dados)'

  f.dataConfirmed = true
  f.dataConfirmedAt = Date.now()
  f.dataChanged = f.data.some((v, i) => v !== f.dataPrefill?.[i])
  log(ctx, 'success', `${ct.number} confirmou os dados${f.dataChanged ? ' (com alterações)' : ''}: ${f.data.join(' · ')}.`)
  queueLeadWebhook(ctx, ct)

  const reply = ctx.flow.replies.qualified
  if (reply && !f.finalReplied) {
    f.finalReplied = true
    const vars = { ...ct.vars, ...dataVars(ds.fields, f.data) }
    enqueueReply(ctx, ct, to, 'a mensagem final', () => ({ send: sendText, payload: { text: renderTemplate(reply, vars) } }))
  }
  return 'Dados confirmados'
}

// ---- Webhook de leads qualificados ------------------------------------------------------

const WEBHOOK_RETRY_DELAYS = [15_000, 60_000, 300_000] // depois da 1ª tentativa

/** POST JSON com timeout. Nunca lança: devolve { ok, status, body, error }. */
export async function postJson(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Disparos-WhatsApp/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.text()).slice(0, 500)
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    const error = err.name === 'TimeoutError' ? 'tempo esgotado (15s)' : err.cause?.code || err.message
    return { ok: false, status: 0, body: '', error }
  }
}

function leadPayloadOf(ctx, ct) {
  const f = ct.flow
  return buildLeadPayload({
    webhook: ctx.flow.webhook,
    fields: ctx.flow.dataStep?.fields || [],
    values: f.data || [],
    vars: ct.vars,
    number: ct.number,
    revenue: f.revenueLabel,
    campaign: ctx.isTest ? 'Envio de teste' : ctx.name,
    changed: f.dataChanged,
    confirmedAt: f.dataConfirmedAt || f.revenueAt,
    test: Boolean(ctx.isTest),
  })
}

/** Envia o lead ao webhook com novas tentativas para erros temporários (rede, 408, 429, 5xx). */
async function sendLeadWebhook(ctx, ct) {
  const url = ctx.flow.webhook?.url
  if (!url) return
  const f = ct.flow
  f.webhook = { status: 'pending', attempts: 0, error: null, at: null }
  persist(ctx)
  const payload = leadPayloadOf(ctx, ct)

  for (let attempt = 0; ; attempt++) {
    const r = await postJson(url, payload)
    f.webhook.attempts = attempt + 1
    f.webhook.httpStatus = r.status
    if (r.ok) {
      Object.assign(f.webhook, { status: 'sent', at: Date.now(), error: null })
      log(ctx, 'success', `Lead ${ct.number} enviado ao webhook (HTTP ${r.status}).`)
      persist(ctx)
      return
    }
    f.webhook.error = r.error || `HTTP ${r.status}${r.body ? ` — ${r.body.slice(0, 150)}` : ''}`
    const retryable = r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500
    if (!retryable || attempt >= WEBHOOK_RETRY_DELAYS.length) {
      f.webhook.status = 'failed'
      log(ctx, 'error', `Falha ao enviar o lead ${ct.number} ao webhook: ${f.webhook.error}`)
      persist(ctx)
      return
    }
    persist(ctx)
    await sleep(WEBHOOK_RETRY_DELAYS[attempt])
  }
}

function queueLeadWebhook(ctx, ct) {
  if (!ctx.flow.webhook?.url) return
  sendLeadWebhook(ctx, ct).catch((err) => console.error('Erro no webhook de leads:', err))
}

/** Reenvia os leads cujo webhook falhou. Retorna quantos foram reenviados. */
export function retryFailedWebhooks(c) {
  if (!c.flow?.webhook?.url) throw new ValidationError('Esta campanha não tem webhook configurado.')
  const failed = c.contacts.filter((ct) => ct.flow?.webhook?.status === 'failed')
  if (!failed.length) throw new ValidationError('Não há envios ao webhook com falha.')
  log(c, 'info', `Reenviando ${failed.length} ${failed.length === 1 ? 'lead' : 'leads'} ao webhook.`)
  for (const ct of failed) queueLeadWebhook(c, ct)
  return failed.length
}

/** Na inicialização: retoma envios que estavam pendentes quando o servidor parou. */
export function resumePendingWebhooks() {
  for (const c of listCampaigns()) {
    if (!c.flow?.webhook?.url) continue
    for (const ct of c.contacts) if (ct.flow?.webhook?.status === 'pending') queueLeadWebhook(c, ct)
  }
}

// ---- Entrada: eventos vindos do SSE ou do webhook --------------------------------------

const seen = new Set()
const recent = []

function remember(entry) {
  recent.unshift({ at: Date.now(), ...entry })
  if (recent.length > 30) recent.length = 30
}

export const recentEvents = () => recent

export function handleIncoming(evt) {
  const extracted = extractMessage(evt)
  if (!extracted) return
  const { msg, chat } = extracted
  if (msg.fromMe || msg.isGroup || msg.wasSentByApi) return

  const dedupeKey = msg.messageid || msg.id
  if (dedupeKey) {
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    if (seen.size > 5000) seen.delete(seen.values().next().value)
  }

  const phones = [msg.sender_pn, msg.chatid, msg.sender, chat.wa_chatid, chat.phone].map(jidDigits).filter(Boolean)
  const replyTo = msg.chatid || msg.sender_pn || null
  const text = String(msg.text || '').trim()
  const choice = selectedId(msg)
  const parsed = choice.match(BUTTON_ID_RE)

  let ctx = null
  let ct = null
  let answer = null

  if (parsed) {
    // Clique em botão/lista: o ID traz a campanha e a resposta
    ctx = contextByKey(parsed[1])
    ct = ctx && (findByMessageId(ctx, msg.quoted) || findByPhone(ctx, phones))
    answer = { kind: parsed[2], value: Number(parsed[3]) }
  } else if (text && text.length <= 500) {
    // Resposta digitada: só vale para contatos aguardando resposta em campanhas recentes
    const now = Date.now()
    for (const candidate of contexts()) {
      if (now - candidate.createdAt > TYPED_REPLY_WINDOW) continue
      const found = findByMessageId(candidate, msg.quoted) || findByPhone(candidate, phones)
      if (!found || stageOf(found, candidate.flow) === 'done') continue
      const a = typedAnswer(candidate, found, text)
      if (a) {
        ctx = candidate
        ct = found
        answer = a
        break
      }
    }
  }

  const from = phones[0] || msg.chatid || '?'
  if (!ctx || !ct || !answer) {
    if (parsed || choice) remember({ from, text: text || choice, matched: false, note: 'Contato não encontrado nas campanhas' })
    return
  }

  const to = replyTo || ct.jid || ct.number
  const ds = ctx.flow.dataStep
  const answerLabel = {
    i: () => ctx.flow.buttons[answer.value ? 'yes' : 'no'],
    r: () => ctx.flow.options[answer.value]?.label,
    c: () => ds?.[answer.value ? 'confirmLabel' : 'editLabel'],
    e: () => answer.value,
  }[answer.kind]()
  ;(ct.flow ||= {}).lastReply = text || answerLabel || choice
  ct.flow.lastReplyAt = Date.now()

  let note
  if (answer.kind === 'i') {
    applyInterest(ctx, ct, answer.value === 1, to)
    note = answer.value ? 'Tem interesse' : 'Sem interesse'
  } else if (answer.kind === 'r') {
    note = applyRevenue(ctx, ct, answer.value, to)
      ? `Faturamento: ${ctx.flow.options[answer.value]?.label}`
      : `Faixa já informada antes (${ct.flow.revenueLabel}) — mantida`
  } else if (answer.kind === 'c') {
    note = applyConfirmation(ctx, ct, answer.value === 1, to)
  } else {
    note = applyFieldAnswer(ctx, ct, answer.value, to)
  }

  remember({
    from,
    text: text || answerLabel || choice,
    matched: true,
    campaign: ctx.isTest ? 'Envio de teste' : ctx.name,
    note,
  })
  persist(ctx)
}

// ---- Resumo para a tela ----------------------------------------------------------------

export function flowCounts(c) {
  const counts = {
    interested: 0,
    notInterested: 0,
    answered: 0,
    qualified: 0,
    notQualified: 0,
    awaiting: 0,
    noReply: 0,
    confirmed: 0,
    awaitingData: 0,
    webhookSent: 0,
    webhookFailed: 0,
    webhookPending: 0,
  }
  const byOption = c.flow.options.map(() => 0)
  for (const ct of c.contacts) {
    if (ct.status !== 'sent') continue
    const f = ct.flow || {}
    if (f.interest === 'yes') counts.interested++
    else if (f.interest === 'no') counts.notInterested++
    else counts.noReply++
    if (f.revenueIndex != null) {
      counts.answered++
      byOption[f.revenueIndex]++
      const wh = f.webhook?.status
      if (wh === 'sent') counts.webhookSent++
      else if (wh === 'failed') counts.webhookFailed++
      else if (wh === 'pending') counts.webhookPending++
      if (f.qualified) {
        counts.qualified++
        if (f.dataConfirmed) counts.confirmed++
        else if (c.flow.dataStep) counts.awaitingData++
      } else counts.notQualified++
    } else if (f.interest === 'yes') counts.awaiting++
  }
  return { ...counts, byOption }
}

export const FLOW_FILTERS = {
  interested: (f) => f.interest === 'yes',
  no_interest: (f) => f.interest === 'no',
  qualified: (f) => f.qualified === true,
  not_qualified: (f) => f.revenueIndex != null && !f.qualified,
  awaiting: (f) => f.interest === 'yes' && f.revenueIndex == null,
  no_reply: (f) => !f.interest,
  confirmed: (f) => f.dataConfirmed === true,
  awaiting_data: (f) => f.qualified === true && !f.dataConfirmed,
  webhook_failed: (f) => f.webhook?.status === 'failed',
}
