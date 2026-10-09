// Persistência simples em arquivos JSON (data/campaigns) e mídias enviadas (data/uploads)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CAMPAIGNS_DIR, UPLOADS_DIR } from './env.js'

const LOG_LIMIT = 200

const campaigns = new Map()

/** Registro de atividade da campanha (mantém só os últimos eventos). */
export function appendLog(c, level, text) {
  c.log.push({ at: Date.now(), level, text })
  if (c.log.length > LOG_LIMIT) c.log.splice(0, c.log.length - LOG_LIMIT)
}
const pendingSaves = new Map()

const campaignFile = (id) => path.join(CAMPAIGNS_DIR, `${id}.json`)

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

export function loadCampaigns() {
  for (const name of fs.readdirSync(CAMPAIGNS_DIR)) {
    if (!name.endsWith('.json')) continue
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR, name), 'utf8'))
      if (c.status === 'running' || c.status === 'queued') {
        c.nextSendAt = null
        c.pauseReason = null
        if (c.resumeAfterRestart) {
          // Desligamento gracioso (ex.: novo deploy): o estado foi salvo, então retoma sozinha
          c.status = 'queued'
          c.queuedAt = Date.now()
          c.startNote = 'Servidor reiniciado. Retomando o disparo automaticamente.'
        } else {
          // Queda inesperada: o último envio pode não ter sido registrado, então o usuário decide
          c.status = 'paused'
          c.lastError = 'O servidor parou inesperadamente durante o disparo. Confira os envios e clique em "Retomar".'
        }
      }
      delete c.resumeAfterRestart
      campaigns.set(c.id, c)
    } catch (err) {
      console.error(`Não foi possível ler ${name}:`, err.message)
    }
  }
  return campaigns.size
}

export const getCampaign = (id) => campaigns.get(id)

export const listCampaigns = () => [...campaigns.values()].sort((a, b) => b.createdAt - a.createdAt)

export function addCampaign(c) {
  campaigns.set(c.id, c)
  saveCampaign(c, true)
}

export function removeCampaign(id) {
  clearTimeout(pendingSaves.get(id))
  pendingSaves.delete(id)
  campaigns.delete(id)
  fs.rmSync(campaignFile(id), { force: true })
}

/** Grava com debounce para não reescrever o arquivo a cada contato. */
export function saveCampaign(c, immediate = false) {
  clearTimeout(pendingSaves.get(c.id))
  pendingSaves.delete(c.id)
  if (immediate) {
    writeAtomic(campaignFile(c.id), JSON.stringify(c))
    return
  }
  pendingSaves.set(
    c.id,
    setTimeout(() => {
      pendingSaves.delete(c.id)
      if (campaigns.has(c.id)) writeAtomic(campaignFile(c.id), JSON.stringify(c))
    }, 1000),
  )
}

export function flushAll() {
  for (const id of [...pendingSaves.keys()]) {
    const c = campaigns.get(id)
    if (c) saveCampaign(c, true)
  }
}

// ---- Uploads de mídia -------------------------------------------------------

const uploadCache = new Map()

function cacheUpload(id, base64) {
  uploadCache.set(id, base64)
  if (uploadCache.size > 10) uploadCache.delete(uploadCache.keys().next().value)
}

export function saveUpload({ base64, mimetype, fileName }) {
  const id = crypto.randomUUID()
  fs.writeFileSync(path.join(UPLOADS_DIR, `${id}.b64`), base64)
  fs.writeFileSync(path.join(UPLOADS_DIR, `${id}.json`), JSON.stringify({ mimetype, fileName }))
  cacheUpload(id, base64)
  return id
}

export function readUpload(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  if (uploadCache.has(id)) return uploadCache.get(id)
  try {
    const base64 = fs.readFileSync(path.join(UPLOADS_DIR, `${id}.b64`), 'utf8')
    cacheUpload(id, base64)
    return base64
  } catch {
    return null
  }
}
