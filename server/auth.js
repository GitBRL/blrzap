// Autenticação do painel: usuário admin + senha do .env, sessão em cookie assinado (HMAC).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './env.js'

const COOKIE = 'disparos_session'
const SESSION_TTL = 12 * 3600_000 // sem "manter conectado"
const REMEMBER_TTL = 30 * 24 * 3600_000
const MAX_FAILURES = 10
const LOCK_WINDOW = 15 * 60_000

export const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim()
// APP_PASSWORD é aceito por compatibilidade com versões anteriores
const PASSWORD = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || ''
export const authEnabled = Boolean(PASSWORD)

/** Segredo das sessões: SESSION_SECRET ou um arquivo gerado no volume (sobrevive a reinícios). */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  const file = path.join(DATA_DIR, 'session.key')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    const secret = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(file, secret, { mode: 0o600 })
    return secret
  }
}

// A chave inclui usuário e senha: trocar a senha no .env encerra todas as sessões
const key = crypto.createHmac('sha256', loadSecret()).update(`${ADMIN_USER}\n${PASSWORD}`).digest()
const sign = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url')
const digest = (v) => crypto.createHash('sha256').update(String(v ?? '')).digest()

function createToken(user, ttl) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + ttl })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return data.exp > Date.now() ? data : null
  } catch {
    return null
  }
}

/** Compara usuário (sem diferenciar maiúsculas) e senha em tempo constante. */
export function checkCredentials(username, password) {
  const userOk = crypto.timingSafeEqual(digest(String(username || '').trim().toLowerCase()), digest(ADMIN_USER.toLowerCase()))
  const passOk = crypto.timingSafeEqual(digest(password), digest(PASSWORD))
  return userOk && passOk
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function currentUser(req) {
  if (!authEnabled) return null
  return verifyToken(readCookie(req))?.u || null
}

function cookieAttributes(req, maxAgeSeconds) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax']
  if (req.secure) attrs.push('Secure')
  if (maxAgeSeconds !== undefined) attrs.push(`Max-Age=${maxAgeSeconds}`)
  return attrs.join('; ')
}

export function startSession(req, res, user, remember) {
  const ttl = remember ? REMEMBER_TTL : SESSION_TTL
  // Sem "manter conectado" o cookie é de sessão do navegador (some ao fechar)
  const maxAge = remember ? Math.floor(ttl / 1000) : undefined
  res.append('Set-Cookie', `${COOKIE}=${createToken(user, ttl)}; ${cookieAttributes(req, maxAge)}`)
}

export function endSession(req, res) {
  res.append('Set-Cookie', `${COOKIE}=; ${cookieAttributes(req, 0)}`)
}

/** Bloqueia /api para quem não está logado (quando há senha configurada). */
export function requireAuth(req, res, next) {
  if (!authEnabled || currentUser(req)) return next()
  res.status(401).json({ error: 'Faça login para continuar.' })
}

// ---- Limite de tentativas de login por IP ------------------------------------------------

const failures = new Map()

export function loginBlockedFor(ip) {
  const entry = failures.get(ip)
  if (!entry || entry.resetAt < Date.now()) return 0
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0
}

export function registerFailure(ip) {
  const now = Date.now()
  const entry = failures.get(ip)
  if (!entry || entry.resetAt < now) failures.set(ip, { count: 1, resetAt: now + LOCK_WINDOW })
  else entry.count++
  if (failures.size > 10_000) failures.delete(failures.keys().next().value)
}

export const clearFailures = (ip) => failures.delete(ip)
