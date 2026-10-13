// Carrega o .env antes de qualquer outro módulo ler process.env
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const envFile = path.join(ROOT, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

// No Railway, o volume anexado ao serviço é usado automaticamente
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || 'data')
export const ON_RAILWAY = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID)

/**
 * Endereço público do painel (a uazapi baixa as mídias grandes por ele).
 * PUBLIC_URL tem prioridade; no Railway, usa o domínio gerado do serviço.
 */
export function publicBaseUrl() {
  const explicit = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  return process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''
}
export const CAMPAIGNS_DIR = path.join(DATA_DIR, 'campaigns')
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')

for (const dir of [DATA_DIR, CAMPAIGNS_DIR, UPLOADS_DIR]) fs.mkdirSync(dir, { recursive: true })
