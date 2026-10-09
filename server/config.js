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
