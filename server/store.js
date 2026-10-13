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
//
// Arquivos novos chegam em partes (upload em chunks) e ficam em binário: <id>.bin + <id>.json.
// Uploads antigos, em base64 (<id>.b64), continuam funcionando para campanhas já criadas.

export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
const ID_RE = /^[0-9a-f-]{36}$/
const uploadPath = (id, ext) => path.join(UPLOADS_DIR, `${id}.${ext}`)

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(uploadPath(id, 'json'), 'utf8'))
  } catch {
    return null
  }
}

/** Dados do upload: { kind: 'bin' | 'b64', fileName, mimetype, size, complete } ou null. */
export function uploadInfo(id) {
  if (!ID_RE.test(String(id))) return null
  const meta = readMeta(id)
  if (fs.existsSync(uploadPath(id, 'bin'))) return meta ? { kind: 'bin', ...meta } : null
  if (fs.existsSync(uploadPath(id, 'b64'))) {
    const size = Math.floor((fs.statSync(uploadPath(id, 'b64')).size * 3) / 4)
    return { kind: 'b64', fileName: meta?.fileName || '', mimetype: meta?.mimetype || '', size, complete: true }
  }
  return null
}

export const uploadFilePath = (id) => uploadPath(id, 'bin')

/** Cria um upload vazio; as partes são gravadas depois em suas posições. */
export function createUpload({ fileName, mimetype, size }) {
  const id = crypto.randomUUID()
  fs.writeFileSync(uploadPath(id, 'bin'), '')
  const meta = { fileName, mimetype, size, chunkSize: UPLOAD_CHUNK_SIZE, complete: false, createdAt: Date.now() }
  fs.writeFileSync(uploadPath(id, 'json'), JSON.stringify(meta))
  return { id, chunkSize: UPLOAD_CHUNK_SIZE }
}

/** Grava a parte `index` na posição certa (repetir a mesma parte é seguro). */
export async function writeUploadChunk(id, index, buffer) {
  const info = uploadInfo(id)
  if (!info || info.kind !== 'bin') throw new Error('Upload não encontrado.')
  if (info.complete) throw new Error('Upload já finalizado.')
  const offset = index * info.chunkSize
  const expected = Math.min(info.chunkSize, info.size - offset)
  if (!Number.isInteger(index) || index < 0 || expected <= 0) throw new Error('Parte do arquivo inválida.')
  if (buffer.length !== expected) throw new Error(`Parte ${index} com tamanho inesperado.`)
  const handle = await fs.promises.open(uploadPath(id, 'bin'), 'r+')
  try {
    await handle.write(buffer, 0, buffer.length, offset)
  } finally {
    await handle.close()
  }
}

export function completeUpload(id) {
  const info = uploadInfo(id)
  if (!info || info.kind !== 'bin') throw new Error('Upload não encontrado.')
  const actual = fs.statSync(uploadPath(id, 'bin')).size
  if (actual !== info.size) throw new Error(`Arquivo incompleto (${actual} de ${info.size} bytes). Envie novamente.`)
  const { kind, ...meta } = info
  fs.writeFileSync(uploadPath(id, 'json'), JSON.stringify({ ...meta, complete: true }))
  return { id, size: actual }
}

// Cache só de arquivos pequenos em base64 (os grandes vão por link, sem passar pela memória)
const base64Cache = new Map()
const CACHE_MAX_BYTES = 8 * 1024 * 1024

/** Conteúdo em base64 (para envio sem endereço público). */
export function readUploadBase64(id) {
  const info = uploadInfo(id)
  if (!info?.complete) return null
  if (base64Cache.has(id)) return base64Cache.get(id)
  const base64 =
    info.kind === 'b64' ? fs.readFileSync(uploadPath(id, 'b64'), 'utf8') : fs.readFileSync(uploadPath(id, 'bin')).toString('base64')
  if (info.size <= CACHE_MAX_BYTES) {
    base64Cache.set(id, base64)
    if (base64Cache.size > 20) base64Cache.delete(base64Cache.keys().next().value)
  }
  return base64
}

/**
 * Apaga uploads com mais de 24 h que nenhuma campanha usa (incompletos ou órfãos).
 * Libera espaço no volume: vídeos podem ter centenas de MB.
 */
export function cleanupUploads(referenced) {
  const cutoff = Date.now() - 24 * 3600_000
  const ids = new Set(fs.readdirSync(UPLOADS_DIR).map((f) => f.split('.')[0]).filter((id) => ID_RE.test(id)))
  let removed = 0
  for (const id of ids) {
    if (referenced.has(id)) continue
    const files = ['bin', 'b64', 'json'].map((ext) => uploadPath(id, ext)).filter((f) => fs.existsSync(f))
    if (files.some((f) => fs.statSync(f).mtimeMs > cutoff)) continue
    for (const f of files) fs.rmSync(f, { force: true })
    removed++
  }
  return removed
}
