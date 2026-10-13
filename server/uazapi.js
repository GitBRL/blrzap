// Cliente HTTP mínimo para a API uazapiGO (https://docs.uazapi.com)
import { getConfig } from './config.js'

export class UazapiError extends Error {
  constructor(message, { status = 0, data = null, kind = 'http', retryAfter = null } = {}) {
    super(message)
    this.status = status
    this.data = data
    this.kind = kind // http | config | network | timeout
    this.retryAfter = retryAfter
  }
}

const UNAUTHORIZED_HINT =
  'Token recusado pela uazapi (HTTP 401). Use o token da INSTÂNCIA (não o admintoken do servidor) ' +
  'e confira se a Server URL é a do servidor onde essa instância foi criada.'

function errorMessage(data, status) {
  if (status === 401) {
    const detail = data && typeof data === 'object' ? String(data.error || data.message || '').replace(/\.$/, '') : ''
    return detail ? `${UNAUTHORIZED_HINT} Resposta: "${detail}"` : UNAUTHORIZED_HINT
  }
  if (data && typeof data === 'object') {
    return data.provider_message_ptbr || data.message_ptbr || data.error || data.message || `HTTP ${status}`
  }
  return (typeof data === 'string' && data.trim().slice(0, 300)) || `HTTP ${status}`
}

async function request(path, { method = 'GET', body, timeout = 30_000 } = {}) {
  const { baseUrl, token } = getConfig()
  if (!baseUrl || !token) {
    throw new UazapiError('Configure a URL do servidor e o token da instância uazapi.', { kind: 'config' })
  }

  let res
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: { token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new UazapiError('Tempo esgotado aguardando a uazapi (a mensagem pode ter sido enviada).', { kind: 'timeout' })
    }
    throw new UazapiError(`Falha de conexão com a uazapi: ${err.cause?.code || err.message}`, { kind: 'network' })
  }

  const text = await res.text()
  let data = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // resposta não-JSON: mantém o texto
  }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after')) || null
    throw new UazapiError(errorMessage(data, res.status), { status: res.status, data, retryAfter })
  }
  return data
}

export const instanceStatus = () => request('/instance/status', { timeout: 15_000 })

// ---- Versão do servidor (GET /status é público) ------------------------------------------

let versionCache = { baseUrl: '', value: null, expires: 0 }

/** Versão da uazapi em execução (ex.: "2.4.2"), com cache de 10 min. null se não conseguir ler. */
export async function serverVersion() {
  const { baseUrl } = getConfig()
  if (!baseUrl) return null
  if (versionCache.baseUrl === baseUrl && versionCache.expires > Date.now()) return versionCache.value
  let value = null
  try {
    const res = await fetch(`${baseUrl}/status`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (res.ok) value = (await res.json())?.build?.version || null
  } catch {
    // sem versão: tratamos como servidor antigo (o caminho mais compatível)
  }
  versionCache = { baseUrl, value, expires: Date.now() + (value ? 10 * 60_000 : 60_000) }
  return value
}

export function versionAtLeast(version, min) {
  if (!version) return false
  const a = String(version).split('.').map((n) => parseInt(n, 10) || 0)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]
  }
  return true
}

/** Vídeo e documento no topo de botões só existem a partir da uazapi 2.6.0. */
export const supportsButtonMedia = async () => versionAtLeast(await serverVersion(), '2.6.0')

export const checkNumbers = (numbers) => request('/chat/check', { method: 'POST', body: { numbers }, timeout: 60_000 })

export const sendText = (payload) =>
  request('/send/text', { method: 'POST', body: payload, timeout: 60_000 + (payload.delay || 0) })

export const sendMedia = (payload) =>
  request('/send/media', { method: 'POST', body: payload, timeout: 120_000 + (payload.delay || 0) })

/** Botões, listas e enquetes (type: button | list | poll). */
export const sendMenu = (payload) =>
  request('/send/menu', { method: 'POST', body: payload, timeout: 120_000 + (payload.delay || 0) })

/**
 * Erros que tornam inútil continuar o disparo (todo envio seguinte falharia).
 * Retorna a mensagem para o usuário, ou null se o erro é só deste contato.
 */
export function fatalReason(err) {
  if (!(err instanceof UazapiError)) return null
  if (err.kind === 'config') return err.message
  if (err.kind === 'network') return err.message
  if (err.status === 401) return err.message
  const d = err.data || {}
  if (d.error_key === 'WHATSAPP_REACHOUT_TIMELOCK' || d.provider_code === 463) {
    return 'O WhatsApp restringiu temporariamente esta conta para iniciar novas conversas (erro 463). Aguarde antes de retomar.'
  }
  if (/not connected|no active session|disconnected|not logged/i.test(err.message)) {
    return 'A instância do WhatsApp está desconectada. Reconecte-a na uazapi e retome o disparo.'
  }
  return null
}
