// Execução dos workflows: cada contato anda pelo grafo conforme responde.
//
// O estado de cada contato fica em `ct.wf`. O workflow da campanha é uma CÓPIA do template
// feita na criação (`c.workflow`), então editar o template não mexe em campanha rodando.
// Campanhas antigas, com `c.flow`, continuam no motor de `flow.js`.
import crypto from 'node:crypto'
import { renderTemplate } from '../shared/template.js'
import { parseNumber, rowMatches } from '../shared/filters.js'
import { autoMapFields, prefillValue, summaryText, validateField, WHATSAPP_COLUMN } from '../shared/datafields.js'
import { normalizePhone } from '../shared/phone.js'
import { isWithinWindow, nextWindowStart } from '../shared/schedule.js'
import { isWaiting, LIMITS, nextOf, NODE_TYPES, nodeById, startNode, timeoutMs, usesList } from '../shared/workflow.js'
import { ValidationError } from './errors.js'
import { appendLog, listCampaigns, saveCampaign } from './store.js'
import { sendMedia, sendMenu, sendText } from './uazapi.js'
import {
  extractMessage,
  findByMessageId,
  findByPhone,
  jidDigits,
  normalize,
  postJson,
  remember,
  selectedId,
  serialSend,
  sleep,
  stripOwner,
  TYPED_REPLY_WINDOW,
  WEBHOOK_RETRY_DELAYS,
} from './flow.js'

// dw:<campanha>:<bloco>:<opção> — o clique traz a campanha, o bloco e a opção escolhida
const BUTTON_ID_RE = /^dw:([a-z0-9]+):([a-z][a-z0-9]{0,11}):(\d{1,2})$/
const TEST_SESSION_TTL = 24 * 3600_000
const STEPS_PER_RUN = 25 // blocos seguidos sem pausa (o editor já recusa laço sem pergunta)
const MSG_IDS_LIMIT = 60
const TICK_MS = 30_000

export const wfButtonId = (key, nodeId, i) => `dw:${key}:${nodeId}:${i}`

const titleOf = (node) => node?.data?.title || NODE_TYPES[node?.type]?.label || 'bloco'

// ---- Contextos: campanhas com workflow + sessões de teste --------------------------------

const testSessions = new Map()

/** O envio de teste cria uma sessão temporária para o workflow rodar no seu próprio número. */
export function createWorkflowTestSession({ workflow, vars, number }) {
  const key = `w${crypto.randomBytes(4).toString('hex').slice(0, 7)}`
  const now = Date.now()
  for (const [k, s] of testSessions) if (now - s.createdAt > TEST_SESSION_TTL) testSessions.delete(k)
  const session = {
    key,
    name: 'Envio de teste',
    workflow,
    createdAt: now,
    isTest: true,
    settings: {},
    contacts: [{ i: 0, number, jid: null, vars, status: 'sent', messageId: null }],
    log: [],
  }
  testSessions.set(key, session)
  return session
}

const contexts = () => [...testSessions.values(), ...listCampaigns().filter((c) => c.workflow)]
const contextByKey = (key) => (key.startsWith('w') ? testSessions.get(key) : listCampaigns().find((c) => c.workflow?.key === key))
const keyOf = (ctx) => (ctx.isTest ? ctx.key : ctx.workflow.key)

function persist(ctx) {
  if (!ctx.isTest) saveCampaign(ctx)
}

const log = (ctx, level, text) => appendLog(ctx, level, text)

function state(ct) {
  return (ct.wf ||= {
    node: null, // bloco em que o contato está parado esperando resposta
    since: null,
    timeoutAt: null,
    vars: {}, // respostas guardadas
    phones: {}, // telefones respondidos, só dígitos com DDI (para o webhook)
    tags: [],
    answers: {}, // bloco → texto da resposta
    choices: {}, // bloco → índice da opção escolhida
    seen: [], // blocos por onde passou (sem repetir)
    msgIds: [],
    webhooks: {},
    timeouts: 0,
    timeoutsByNode: {},
    done: false,
  })
}

/** Variáveis de um contato: colunas da planilha + respostas + sistema. */
function varsOf(ctx, ct) {
  return {
    ...ct.vars,
    ...(ct.wf?.vars || {}),
    whatsapp: ct.number,
    campanha: ctx.isTest ? 'Envio de teste' : ctx.name,
  }
}

function mark(ct, nodeId) {
  const s = state(ct)
  if (!s.seen.includes(nodeId)) s.seen.push(nodeId)
}

// ---- Montagem das mensagens ---------------------------------------------------------------

/** Botões (até 3) ou lista com as opções do bloco. Cada opção leva o ID dw:… de volta. */
export function choicesPayload({ node, key, text }) {
  const d = node.data
  const choices = d.choices.map((c, i) => `${c.label}|${wfButtonId(key, node.id, i)}`)
  const footer = d.footer ? { footerText: d.footer } : {}
  if (!usesList(node)) return { type: 'button', text, choices, ...footer }
  const section = String(d.title || 'Opções').replace(/[[\]|]/g, '').slice(0, 24) || 'Opções'
  return { type: 'list', text, listButton: d.listButton || 'Ver opções', choices: [`[${section}]`, ...choices], ...footer }
}

/**
 * A mensagem da campanha com os botões do bloco de disparo. Com `headerMedia`, a mídia vai
 * no topo dos botões (`file` na uazapi 2.6+; `imageButton` também, para imagem nas anteriores).
 * Lista não leva mídia no topo: nesse caso a mídia sai antes, numa mensagem própria.
 */
export function startMenuPayload({ node, key, text, file, media, headerMedia = true }) {
  const payload = choicesPayload({ node, key, text })
  if (file && headerMedia && payload.type === 'button') {
    payload.file = file
    if (media.type === 'image') payload.imageButton = file
    payload.mimetype = media.mimetype || media.type
    if (media.type === 'document') payload.docName = media.fileName || 'documento'
  }
  return payload
}

const mediaBody = (m) => ({ type: m.type, file: m.url, ...(m.type === 'document' ? { docName: m.fileName || 'documento' } : {}) })

/** As mensagens de um bloco "Mensagem", já com as variáveis aplicadas: [[envio, payload], …]. */
function messageParts(ctx, ct, node) {
  const d = node.data
  const text = renderTemplate(d.text || '', varsOf(ctx, ct)).trim()
  const media = d.media?.url ? d.media : null
  if (d.choices?.length) {
    const payload = choicesPayload({ node, key: keyOf(ctx), text })
    if (media?.type === 'image' && payload.type === 'button') {
      payload.file = media.url
      payload.imageButton = media.url
      payload.mimetype = 'image'
      return [[sendMenu, payload]]
    }
    return media ? [[sendMedia, mediaBody(media)], [sendMenu, payload]] : [[sendMenu, payload]]
  }
  if (media) return [[sendMedia, { ...mediaBody(media), text: text || undefined }]]
  return [[sendText, { text }]]
}

/** Põe na fila única de respostas. As partes são montadas AGORA, com as variáveis de agora. */
function queue(ctx, ct, to, label, parts) {
  serialSend(
    async () => {
      for (const [send, payload] of parts) {
        const res = await send({ number: to, delay: 1500, ...payload })
        const id = res?.messageid || stripOwner(res?.id)
        if (id) {
          const ids = state(ct).msgIds
          ids.push(id)
          if (ids.length > MSG_IDS_LIMIT) ids.splice(0, ids.length - MSG_IDS_LIMIT)
        }
      }
      persist(ctx)
    },
    (err) => {
      log(ctx, 'error', `Falha ao enviar ${label} para ${ct.number}: ${err.message}`)
      persist(ctx)
    },
  )
}

// ---- Caminhar pelo grafo ------------------------------------------------------------------

function waitAt(ct, node) {
  const s = state(ct)
  s.node = node.id
  s.since = Date.now()
  const ms = timeoutMs(node.data.timeout)
  s.timeoutAt = ms && s.timeouts < LIMITS.timeoutsPerContact ? Date.now() + ms : null
}

function finish(ct) {
  const s = state(ct)
  s.node = null
  s.timeoutAt = null
  if (!s.done) {
    s.done = true
    s.doneAt = Date.now()
  }
}

/**
 * Leva o contato ao bloco `nodeId` e executa tudo o que não espera resposta (mensagem sem
 * botões, condição, webhook), até parar num bloco que espera resposta — ou no fim do caminho.
 */
function goTo(ctx, ct, nodeId, to) {
  const s = state(ct)
  const wf = ctx.workflow
  s.node = null
  s.timeoutAt = null
  for (let steps = 0; nodeId; steps++) {
    if (steps >= STEPS_PER_RUN) {
      log(ctx, 'warn', `${ct.number}: o workflow passou por ${STEPS_PER_RUN} blocos seguidos sem pausa e foi interrompido.`)
      break
    }
    const node = nodeById(wf, nodeId)
    if (!node || node.type === 'start') break
    mark(ct, node.id)

    if (node.type === 'message') {
      queue(ctx, ct, to, `a mensagem “${titleOf(node)}”`, messageParts(ctx, ct, node))
      if (isWaiting(node)) return waitAt(ct, node)
      nodeId = nextOf(wf, node.id, 'next')
    } else if (node.type === 'question') {
      queue(ctx, ct, to, `a pergunta “${titleOf(node)}”`, [[sendText, { text: renderTemplate(node.data.text, varsOf(ctx, ct)) }]])
      return waitAt(ct, node)
    } else if (node.type === 'data') {
      startData(ctx, ct, node, to)
      return waitAt(ct, node)
    } else if (node.type === 'condition') {
      const ok = rowMatches(varsOf(ctx, ct), node.data)
      log(ctx, 'info', `${ct.number}: condição “${titleOf(node)}” → ${ok ? 'sim' : 'não'}.`)
      nodeId = nextOf(wf, node.id, ok ? 'yes' : 'no')
    } else if (node.type === 'webhook') {
      queueWebhook(ctx, ct, node)
      nodeId = nextOf(wf, node.id, 'next')
    } else {
      break
    }
  }
  finish(ct)
}

/** Depois que a mensagem da campanha saiu: o contato fica no bloco de disparo (ou segue). */
export function onInitialSent(ctx, ct) {
  const start = startNode(ctx.workflow)
  if (!start) return
  mark(ct, start.id)
  if (isWaiting(start)) waitAt(ct, start)
  else goTo(ctx, ct, nextOf(ctx.workflow, start.id, 'next'), ct.jid || ct.number)
}

// ---- Respostas -----------------------------------------------------------------------------

function applyChoice(ctx, ct, node, index, to) {
  const s = state(ct)
  const choice = node.data.choices?.[index]
  if (!choice) return 'Opção desconhecida — ignorada'
  if (s.node !== node.id) {
    return s.answers[node.id] ? `Já respondido antes (${s.answers[node.id]}) — mantido` : 'Fora de hora — ignorado'
  }
  s.answers[node.id] = choice.label
  s.choices[node.id] = index
  if (node.data.saveAs) s.vars[node.data.saveAs] = choice.label
  if (choice.tag && !s.tags.includes(choice.tag)) s.tags.push(choice.tag)
  log(ctx, choice.tag ? 'success' : 'info', `${ct.number} escolheu “${choice.label}”${choice.tag ? ` — ${choice.tag}` : ''}.`)
  goTo(ctx, ct, nextOf(ctx.workflow, node.id, `c${index}`), to)
  return choice.tag ? `${choice.label} · ${choice.tag}` : choice.label
}

function applyText(ctx, ct, node, text, to) {
  const s = state(ct)
  const d = node.data
  let check
  if (d.answerType === 'number') {
    check = parseNumber(text) === null ? { ok: false, error: 'Não entendi o número. Pode enviar só o valor?' } : { ok: true, value: String(text).trim() }
  } else {
    check = validateField(d.answerType, text)
  }
  if (!check.ok) {
    const warn = d.invalidText ? renderTemplate(d.invalidText, varsOf(ctx, ct)) : check.error
    queue(ctx, ct, to, 'o aviso de resposta inválida', [[sendText, { text: warn }]])
    return `Resposta inválida para “${titleOf(node)}” — pedida de novo`
  }
  s.answers[node.id] = check.value
  s.vars[d.saveAs] = check.value
  if (d.answerType === 'phone') s.phones[d.saveAs] = normalizePhone(check.value) || check.value
  log(ctx, 'info', `${ct.number} respondeu “${titleOf(node)}”: ${check.value}.`)
  goTo(ctx, ct, nextOf(ctx.workflow, node.id, 'next'), to)
  return `${d.saveAs}: ${check.value}`
}

// ---- Bloco "Confirmar dados" ------------------------------------------------------------------

function sendSummary(ctx, ct, node, to) {
  const d = node.data
  const s = state(ct)
  queue(ctx, ct, to, 'o resumo dos dados', [
    [
      sendMenu,
      {
        type: 'button',
        text: summaryText(renderTemplate(d.intro, varsOf(ctx, ct)), d.fields, s.data.values),
        choices: [`${d.confirmLabel}|${wfButtonId(keyOf(ctx), node.id, 0)}`, `${d.editLabel}|${wfButtonId(keyOf(ctx), node.id, 1)}`],
      },
    ],
  ])
}

function askField(ctx, ct, node, to, prefix = '') {
  const field = node.data.fields[state(ct).data.queue[0]]
  const question = renderTemplate(field.question, varsOf(ctx, ct))
  queue(ctx, ct, to, `a pergunta “${field.label}”`, [[sendText, { text: prefix ? `${prefix}\n\n${question}` : question }]])
}

/**
 * Usa o que já existe (planilha, respostas, número), pergunta o que falta e mostra o resumo.
 * Campo sem coluna escolhida é ligado aqui pelo nome (o template não conhece a planilha):
 * "Nome" acha a coluna nome/cliente, "E-mail" a de e-mail, e telefone sem coluna usa o WhatsApp.
 */
function startData(ctx, ct, node, to) {
  const s = state(ct)
  const vars = varsOf(ctx, ct)
  const fields = autoMapFields(node.data.fields, Object.keys(vars))
  const values = fields.map((f) => prefillValue(f, vars, f.column === WHATSAPP_COLUMN ? ct.number : ''))
  s.data = { node: node.id, values, prefill: [...values], queue: values.map((v, i) => (v ? null : i)).filter((i) => i !== null) }
  if (s.data.queue.length) askField(ctx, ct, node, to, renderTemplate(node.data.collectIntro, vars))
  else sendSummary(ctx, ct, node, to)
}

function applyDataText(ctx, ct, node, text, to) {
  const s = state(ct)
  const field = node.data.fields[s.data.queue[0]]
  const check = validateField(field.type, text)
  if (!check.ok) {
    const again = field.type === 'text' ? `${check.error} ${renderTemplate(field.question, varsOf(ctx, ct))}` : check.error
    queue(ctx, ct, to, 'o aviso de dado inválido', [[sendText, { text: again }]])
    return `${field.label} inválido — pedido novamente`
  }
  s.data.values[s.data.queue.shift()] = check.value
  if (s.data.queue.length) askField(ctx, ct, node, to)
  else sendSummary(ctx, ct, node, to)
  return `${field.label}: ${check.value}`
}

function applyConfirm(ctx, ct, node, confirm, to) {
  const s = state(ct)
  const d = node.data
  if (s.node !== node.id || s.data?.node !== node.id) return 'Ignorado (dados já confirmados ou etapa não iniciada)'
  if (!confirm) {
    s.data.queue = d.fields.map((_, i) => i)
    log(ctx, 'info', `${ct.number} pediu para alterar os dados.`)
    askField(ctx, ct, node, to, renderTemplate(d.editIntro, varsOf(ctx, ct)))
    return 'Alterar dados'
  }
  if (s.data.queue.length) return 'Confirmação ignorada (ainda respondendo os dados)'

  const changed = s.data.values.some((v, i) => v !== s.data.prefill[i])
  d.fields.forEach((f, i) => {
    s.vars[f.label] = s.data.values[i] || ''
    if (f.type === 'phone' && s.data.values[i]) s.phones[f.label] = normalizePhone(s.data.values[i]) || s.data.values[i]
  })
  s.vars.data_confirmacao = new Date().toISOString()
  s.vars.dados_alterados = changed ? 'sim' : 'não'
  s.answers[node.id] = changed ? 'Confirmou (com alterações)' : 'Confirmou'
  log(ctx, 'success', `${ct.number} confirmou os dados${changed ? ' (com alterações)' : ''}: ${s.data.values.join(' · ')}.`)
  s.data = null
  goTo(ctx, ct, nextOf(ctx.workflow, node.id, 'next'), to)
  return 'Dados confirmados'
}

// ---- Resposta digitada ----------------------------------------------------------------------

const YES = new Set(['sim', 's', 'quero', 'tenho', 'tenho interesse', 'ok', 'pode', 'claro'])
const NO = new Set(['nao', 'n', 'nao quero', 'nao tenho interesse'])
const CONFIRM = new Set(['1', 'sim', 'confirmar', 'confirmo', 'confirmado', 'ok', 'certo', 'correto'])
const EDIT = new Set(['2', 'alterar', 'mudar', 'corrigir', 'nao'])

/** Opção digitada: o número, o texto da opção, ou sim/não quando dá para saber qual é. */
function typedChoice(node, text) {
  const t = normalize(text)
  if (!t) return null
  const labels = node.data.choices.map((c) => normalize(c.label))
  const n = Number(t)
  if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1
  const exact = labels.indexOf(t)
  if (exact >= 0) return exact
  const negatives = labels.map((l, i) => (/^nao\b/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (NO.has(t) && negatives.length === 1) return negatives[0]
  if (YES.has(t)) {
    const positives = labels.map((l, i) => (/^sim\b/.test(l) ? i : -1)).filter((i) => i >= 0)
    if (positives.length === 1) return positives[0]
    if (labels.length === 2 && negatives.length === 1) return 1 - negatives[0]
  }
  return null
}

/** O que a mensagem digitada significa no bloco em que o contato está parado. */
function typedAction(ct, node, text) {
  if (!node) return null
  if (node.type === 'question') return String(text).trim() ? { node, text } : null
  if (node.type === 'data') {
    const s = ct.wf
    if (s.data?.node !== node.id) return null
    if (s.data.queue.length) return String(text).trim() ? { node, dataText: text } : null
    const t = normalize(text)
    if (CONFIRM.has(t) || t === normalize(node.data.confirmLabel)) return { node, index: 0 }
    if (EDIT.has(t) || t === normalize(node.data.editLabel)) return { node, index: 1 }
    return null
  }
  const index = typedChoice(node, text)
  return index === null ? null : { node, index }
}

function apply(ctx, ct, action, to) {
  const { node } = action
  if (node.type === 'data') {
    if ('dataText' in action) return applyDataText(ctx, ct, node, action.dataText, to)
    return applyConfirm(ctx, ct, node, action.index === 0, to)
  }
  if (node.type === 'question') return applyText(ctx, ct, node, action.text, to)
  return applyChoice(ctx, ct, node, action.index, to)
}

// ---- Entrada: eventos vindos do SSE ou do webhook da uazapi ----------------------------------

const seen = new Set()

/**
 * Trata a mensagem recebida se ela for de um workflow. Retorna false quando não é, para o
 * fluxo antigo (`flow.js`) tentar.
 */
export function handleWorkflowIncoming(evt) {
  const extracted = extractMessage(evt)
  if (!extracted) return false
  const { msg, chat } = extracted
  if (msg.fromMe || msg.isGroup || msg.wasSentByApi) return false

  const dedupeKey = msg.messageid || msg.id
  if (dedupeKey && seen.has(dedupeKey)) return true

  const phones = [msg.sender_pn, msg.chatid, msg.sender, chat.wa_chatid, chat.phone].map(jidDigits).filter(Boolean)
  const from = phones[0] || msg.chatid || '?'
  const text = String(msg.text || '').trim()
  const choice = selectedId(msg)
  const parsed = choice.match(BUTTON_ID_RE)

  let ctx = null
  let ct = null
  let action = null
  if (parsed) {
    ctx = contextByKey(parsed[1])
    ct = ctx && (findByMessageId(ctx, msg.quoted) || findByPhone(ctx, phones))
    const node = ctx && nodeById(ctx.workflow, parsed[2])
    if (node) action = { node, index: Number(parsed[3]) }
    if (!ctx || !ct || !action) {
      remember({ from, text: text || choice, matched: false, note: 'Contato não encontrado nos workflows' })
      if (dedupeKey) seen.add(dedupeKey)
      return true
    }
  } else if (text && text.length <= 1000) {
    const now = Date.now()
    for (const candidate of contexts()) {
      if (now - candidate.createdAt > TYPED_REPLY_WINDOW) continue
      const found = findByMessageId(candidate, msg.quoted) || findByPhone(candidate, phones)
      if (!found?.wf?.node) continue
      const a = typedAction(found, nodeById(candidate.workflow, found.wf.node), text)
      if (a) {
        ctx = candidate
        ct = found
        action = a
        break
      }
    }
    if (!ctx) return false
  } else {
    return false
  }

  if (dedupeKey) {
    seen.add(dedupeKey)
    if (seen.size > 5000) seen.delete(seen.values().next().value)
  }

  const to = msg.chatid || msg.sender_pn || ct.jid || ct.number
  const s = state(ct)
  s.lastReply = text || action.node.data.choices?.[action.index]?.label || choice
  s.lastReplyAt = Date.now()
  const note = apply(ctx, ct, action, to)
  remember({ from, text: s.lastReply, matched: true, campaign: ctx.isTest ? 'Envio de teste' : ctx.name, note })
  persist(ctx)
  return true
}

// ---- "Sem resposta": lembretes e caminhos alternativos -----------------------------------------

let timer = null

export function startWorkflowTimers() {
  if (timer) return
  timer = setInterval(checkTimeouts, TICK_MS)
  timer.unref?.()
}

/**
 * Quem passou do prazo segue pela saída "sem resposta". Respeita a janela de envio da
 * campanha (lembrete não sai de madrugada) e não sai de campanha pausada ou cancelada.
 */
export function checkTimeouts() {
  const now = Date.now()
  for (const ctx of contexts()) {
    if (ctx.status === 'paused' || ctx.status === 'cancelled') continue
    let changed = false
    for (const ct of ctx.contacts) {
      const s = ct.wf
      if (!s?.node || !s.timeoutAt || s.timeoutAt > now) continue
      const w = ctx.settings?.window
      if (w?.enabled && !isWithinWindow(now, w)) {
        s.timeoutAt = nextWindowStart(now, w) || null
        changed = true
        continue
      }
      const node = nodeById(ctx.workflow, s.node)
      const target = node && nextOf(ctx.workflow, node.id, 'timeout')
      s.timeoutAt = null
      changed = true
      if (!target) continue
      s.timeouts++
      s.timeoutsByNode[node.id] = (s.timeoutsByNode[node.id] || 0) + 1
      if (s.data?.node === node.id) s.data = null
      log(ctx, 'info', `${ct.number} não respondeu “${titleOf(node)}” no prazo — seguindo por “sem resposta”.`)
      goTo(ctx, ct, target, ct.jid || ct.number)
    }
    if (changed) persist(ctx)
  }
}

// ---- Bloco "Webhook" -----------------------------------------------------------------------------

const slug = (s) => normalize(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** O JSON do bloco: a tabela chave → valor com as variáveis aplicadas (+ colunas da planilha). */
export function buildWebhookPayload(data, vars, sheet = {}, test = false) {
  const payload = {}
  for (const f of data.fields || []) if (f.key) payload[f.key] = renderTemplate(String(f.value ?? ''), vars).trim()
  if (data.includeSheet) {
    for (const [k, v] of Object.entries(sheet)) {
      const key = `planilha_${slug(k) || 'coluna'}`
      if (!(key in payload)) payload[key] = v ?? ''
    }
  }
  if (test) payload.teste = true
  return payload
}

async function sendWebhook(ctx, ct, node) {
  const s = state(ct)
  const status = (s.webhooks[node.id] = { status: 'pending', attempts: 0, error: null, at: null })
  persist(ctx)
  // Telefones vão só com dígitos e DDI, o formato que CRMs costumam esperar
  const payload = buildWebhookPayload(node.data, { ...varsOf(ctx, ct), ...s.phones }, ct.vars, Boolean(ctx.isTest))

  for (let attempt = 0; ; attempt++) {
    const r = await postJson(node.data.url, payload)
    status.attempts = attempt + 1
    status.httpStatus = r.status
    if (r.ok) {
      Object.assign(status, { status: 'sent', at: Date.now(), error: null })
      log(ctx, 'success', `${ct.number}: webhook “${titleOf(node)}” enviado (HTTP ${r.status}).`)
      persist(ctx)
      return
    }
    status.error = r.error || `HTTP ${r.status}${r.body ? ` — ${r.body.slice(0, 150)}` : ''}`
    const retryable = r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500
    if (!retryable || attempt >= WEBHOOK_RETRY_DELAYS.length) {
      status.status = 'failed'
      log(ctx, 'error', `${ct.number}: falha no webhook “${titleOf(node)}”: ${status.error}`)
      persist(ctx)
      return
    }
    persist(ctx)
    await sleep(WEBHOOK_RETRY_DELAYS[attempt])
  }
}

function queueWebhook(ctx, ct, node) {
  sendWebhook(ctx, ct, node).catch((err) => console.error('Erro no webhook do workflow:', err))
}

/** Reenvia os webhooks que falharam. Retorna quantos foram reenviados. */
export function retryWorkflowWebhooks(c) {
  const jobs = []
  for (const ct of c.contacts) {
    for (const [nodeId, w] of Object.entries(ct.wf?.webhooks || {})) {
      const node = nodeById(c.workflow, nodeId)
      if (w.status === 'failed' && node) jobs.push([ct, node])
    }
  }
  if (!jobs.length) throw new ValidationError('Não há envios ao webhook com falha.')
  log(c, 'info', `Reenviando ${jobs.length} ${jobs.length === 1 ? 'envio' : 'envios'} ao webhook.`)
  for (const [ct, node] of jobs) queueWebhook(c, ct, node)
  return jobs.length
}

/** Na inicialização: retoma os envios que estavam pendentes quando o servidor parou. */
export function resumeWorkflowWebhooks() {
  for (const c of listCampaigns()) {
    if (!c.workflow) continue
    for (const ct of c.contacts) {
      for (const [nodeId, w] of Object.entries(ct.wf?.webhooks || {})) {
        const node = nodeById(c.workflow, nodeId)
        if (w.status === 'pending' && node) queueWebhook(c, ct, node)
      }
    }
  }
}

// ---- Resumo para a tela e filtros -------------------------------------------------------------

export function workflowCounts(c) {
  const byNode = Object.fromEntries(
    c.workflow.nodes.map((n) => [n.id, { reached: 0, waiting: 0, timeouts: 0, choices: (n.data.choices || []).map(() => 0) }]),
  )
  const tags = {}
  const webhooks = { sent: 0, failed: 0, pending: 0 }
  const counts = { started: 0, replied: 0, noReply: 0, waiting: 0, done: 0 }
  for (const ct of c.contacts) {
    const s = ct.wf
    if (ct.status !== 'sent' || !s) continue
    counts.started++
    if (s.lastReplyAt) counts.replied++
    else counts.noReply++
    if (s.node) counts.waiting++
    if (s.done) counts.done++
    for (const id of s.seen || []) if (byNode[id]) byNode[id].reached++
    if (s.node && byNode[s.node]) byNode[s.node].waiting++
    for (const [id, idx] of Object.entries(s.choices || {})) if (byNode[id]?.choices[idx] != null) byNode[id].choices[idx]++
    for (const [id, n] of Object.entries(s.timeoutsByNode || {})) if (byNode[id]) byNode[id].timeouts += n
    for (const t of s.tags || []) tags[t] = (tags[t] || 0) + 1
    for (const w of Object.values(s.webhooks || {})) if (w.status in webhooks) webhooks[w.status]++
  }
  return { ...counts, byNode, tags, webhooks }
}

/**
 * Filtro de contatos por estado no workflow: "waiting:n3", "reached:n3", "choice:n2.1",
 * "tag:Qualificado", "active", "done", "replied", "no_reply", "webhook_failed".
 */
export function workflowFilter(key) {
  const [kind, ...rest] = String(key || '').split(':')
  const value = rest.join(':')
  switch (kind) {
    case 'waiting':
      return (s) => s.node === value
    case 'reached':
      return (s) => (s.seen || []).includes(value)
    case 'choice': {
      const [node, idx] = value.split('.')
      return (s) => String(s.choices?.[node]) === idx
    }
    case 'tag':
      return (s) => (s.tags || []).includes(value)
    case 'active':
      return (s) => Boolean(s.node)
    case 'done':
      return (s) => Boolean(s.done)
    case 'replied':
      return (s) => Boolean(s.lastReplyAt)
    case 'no_reply':
      return (s) => !s.lastReplyAt
    case 'webhook_failed':
      return (s) => Object.values(s.webhooks || {}).some((w) => w.status === 'failed')
    default:
      return null
  }
}
