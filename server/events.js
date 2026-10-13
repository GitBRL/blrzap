// Recebimento das respostas dos contatos.
// Padrão: o servidor abre uma conexão SSE com a uazapi (funciona sem URL pública).
// Alternativa: a uazapi chama POST /api/webhook/uazapi (exige URL pública).
import crypto from 'node:crypto'
import { getConfig } from './config.js'
import { handleIncoming } from './flow.js'
import { handleWorkflowIncoming } from './workflow.js'

const state = {
  sse: { connected: false, connectedAt: null, lastEventAt: null, lastError: null, received: 0 },
  webhook: { lastEventAt: null, received: 0 },
}

let controller = null
let retryTimer = null
let backoff = 1000
let enabled = false

export const listenerStatus = () => state

function dispatch(data, source) {
  let evt
  try {
    evt = JSON.parse(data)
  } catch {
    return
  }
  state[source].lastEventAt = Date.now()
  state[source].received++
  try {
    // Workflow primeiro; o que não for dele vai para o fluxo antigo (campanhas anteriores)
    if (!handleWorkflowIncoming(evt)) handleIncoming(evt)
  } catch (err) {
    console.error('Erro ao processar evento da uazapi:', err)
  }
}

async function connect() {
  clearTimeout(retryTimer)
  controller?.abort()
  const { baseUrl, token } = getConfig()
  if (!enabled) return
  if (!baseUrl || !token) {
    state.sse.connected = false
    state.sse.lastError = 'Configure a URL e o token da uazapi.'
    return
  }

  const ctrl = new AbortController()
  controller = ctrl
  try {
    const url = `${baseUrl}/sse?token=${encodeURIComponent(token)}&events=messages`
    const res = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal })
    if (!res.ok) throw new Error(res.status === 401 ? 'token recusado (HTTP 401)' : `HTTP ${res.status}`)

    Object.assign(state.sse, { connected: true, connectedAt: Date.now(), lastError: null })
    backoff = 1000

    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n')
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
        if (data) dispatch(data, 'sse')
      }
    }
    throw new Error('conexão encerrada pela uazapi')
  } catch (err) {
    if (ctrl.signal.aborted) return
    // Nunca registrar a URL (ela contém o token)
    const reason = err.cause?.code || err.message
    Object.assign(state.sse, { connected: false, lastError: `Sem conexão para receber respostas: ${reason}` })
    retryTimer = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, 60_000)
  }
}

/** Liga o recebimento (idempotente). */
export function startListener() {
  if (enabled) return
  enabled = true
  connect()
}

/** Reconecta após mudança de URL/token. */
export function restartListener() {
  if (!enabled) return
  backoff = 1000
  connect()
}

/** Webhook: valida o token da instância enviado no payload e processa depois de responder. */
export function webhookHandler(req, res) {
  const { token } = getConfig()
  const body = req.body || {}
  const hash = (v) => crypto.createHash('sha256').update(String(v ?? '')).digest()
  if (!token || !crypto.timingSafeEqual(hash(body.token), hash(token))) return res.status(401).json({ error: 'token inválido' })
  res.sendStatus(200)
  setImmediate(() => dispatch(JSON.stringify(body), 'webhook'))
}
