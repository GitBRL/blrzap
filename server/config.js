// Credenciais da uazapi: salvas em data/config.json pela tela de configurações,
// com fallback para as variáveis UAZAPI_URL / UAZAPI_TOKEN do .env.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './env.js'

const FILE = path.join(DATA_DIR, 'config.json')

let saved = {}
try {
  saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  saved = {}
}

export function getConfig() {
  return {
    baseUrl: (saved.baseUrl || process.env.UAZAPI_URL || '').trim().replace(/\/+$/, ''),
    token: (saved.token || process.env.UAZAPI_TOKEN || '').trim(),
  }
}

export function setConfig({ baseUrl, token }) {
  if (typeof baseUrl === 'string') {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('URL inválida. Exemplo: https://seusubdominio.uazapi.com')
    saved.baseUrl = url
  }
  // Token vazio mantém o atual (a tela nunca recebe o token completo de volta)
  if (typeof token === 'string' && token.trim()) saved.token = token.trim()

  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
}

/** Versão segura para enviar ao navegador. */
export function publicConfig() {
  const { baseUrl, token } = getConfig()
  return {
    baseUrl,
    hasToken: Boolean(token),
    tokenPreview: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : '',
  }
}

// ---- SMTP (e-mails da régua de cobrança) -------------------------------------------------

export function getSmtp() {
  const s = saved.smtp || {}
  return {
    host: s.host || process.env.SMTP_HOST || '',
    port: Number(s.port || process.env.SMTP_PORT || 587),
    secure: s.secure ?? process.env.SMTP_SECURE === 'true',
    user: s.user || process.env.SMTP_USER || '',
    pass: s.pass || process.env.SMTP_PASS || '',
    fromName: s.fromName || process.env.SMTP_FROM_NAME || '',
    fromEmail: s.fromEmail || process.env.SMTP_FROM || s.user || process.env.SMTP_USER || '',
  }
}

export function setSmtp(input = {}) {
  const current = saved.smtp || {}
  const next = { ...current }
  for (const key of ['host', 'user', 'fromName', 'fromEmail']) {
    if (typeof input[key] === 'string') next[key] = input[key].trim()
  }
  if (input.port !== undefined) {
    const port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta SMTP inválida.')
    next.port = port
  }
  if (input.secure !== undefined) next.secure = Boolean(input.secure)
  // Senha vazia mantém a atual (a tela nunca recebe a senha de volta)
  if (typeof input.pass === 'string' && input.pass) next.pass = input.pass
  if (next.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.fromEmail)) throw new Error('E-mail do remetente inválido.')
  saved.smtp = next
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
}

/** Versão segura para o navegador (sem a senha). */
export function publicSmtp() {
  const { pass, ...rest } = getSmtp()
  return { ...rest, hasPass: Boolean(pass), configured: Boolean(rest.host && rest.fromEmail) }
}

// ---- Instância uazapi do financeiro (régua de cobrança) ---------------------------------

export function getFinanceConfig() {
  const f = saved.financeiro || {}
  return {
    baseUrl: (f.baseUrl || process.env.UAZAPI_FIN_URL || '').trim().replace(/\/+$/, ''),
    token: (f.token || process.env.UAZAPI_FIN_TOKEN || '').trim(),
  }
}

export const hasFinanceInstance = () => {
  const f = getFinanceConfig()
  return Boolean(f.baseUrl && f.token)
}

export function setFinanceConfig({ baseUrl, token }) {
  const next = { ...(saved.financeiro || {}) }
  if (typeof baseUrl === 'string') {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('URL inválida. Exemplo: https://seusubdominio.uazapi.com')
    next.baseUrl = url
  }
  if (typeof token === 'string' && token.trim()) next.token = token.trim()
  saved.financeiro = next
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
}

export function clearFinanceConfig() {
  delete saved.financeiro
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
}

export function publicFinanceConfig() {
  const { baseUrl, token } = getFinanceConfig()
  return { baseUrl, hasToken: Boolean(token), tokenPreview: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : '', configured: Boolean(baseUrl && token) }
}

/**
 * Instância usada pela régua: a do financeiro, quando configurada; senão, a principal.
 * O `label` aparece nos erros para deixar claro de qual instância é o problema.
 */
export function dunningConnection() {
  if (hasFinanceInstance()) return { ...getFinanceConfig(), label: 'Instância do financeiro', kind: 'financeiro' }
  return { ...getConfig(), kind: 'principal' }
}
