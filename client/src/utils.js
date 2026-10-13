import Papa from 'papaparse'
import { api } from './api.js'

/** Lê o CSV aceitando UTF-8 ou Windows-1252 (padrão do Excel em português). */
export async function readCsvFile(file) {
  const buffer = await file.arrayBuffer()
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer)
  }
  text = text.replace(/^﻿/, '')

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h, i) => h.trim() || `coluna_${i + 1}`,
  })
  const headers = (parsed.meta.fields || []).filter(Boolean)
  if (!headers.length) throw new Error('Não foi possível identificar o cabeçalho do CSV.')
  if (!parsed.data.length) throw new Error('O CSV não possui linhas de dados.')
  return { headers, rows: parsed.data, delimiter: parsed.meta.delimiter }
}

const SPREADSHEET_RE = /\.(xlsx|xlsm|xls)$/i

/** Contatos de um CSV ou de uma planilha do Excel (XLS/XLSX), no mesmo formato. */
export function readContactsFile(file) {
  return SPREADSHEET_RE.test(file.name) ? readSpreadsheetFile(file) : readCsvFile(file)
}

const pad = (n) => String(n).padStart(2, '0')

/** A biblioteca devolve o horário da célula como se fosse UTC: lido em UTC, sai o que o Excel mostra. */
function formatCellDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  return d.getUTCHours() || d.getUTCMinutes() ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/**
 * O texto de uma célula, do jeito que a mensagem e os filtros esperam.
 * Número inteiro grande (telefone, CPF) vai inteiro: o Excel o mostra como 5,51E+12.
 * Decimal vai com vírgula e sem milhar; porcentagem, como "15%"; data, como dd/mm/aaaa.
 */
function cellText(cell) {
  if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return ''
  if (cell.t === 'd' || cell.v instanceof Date) return formatCellDate(cell.v)
  if (cell.t === 'b') return cell.v ? 'sim' : 'não'
  if (cell.t === 'n') {
    const v = cell.v
    if (/%/.test(cell.z || '')) return `${String(+(v * 100).toFixed(4)).replace('.', ',')}%`
    return Number.isInteger(v) ? String(v) : String(+v.toFixed(10)).replace('.', ',')
  }
  return String(cell.w ?? cell.v).trim()
}

/** Uma aba da planilha → { headers, rows }, com o cabeçalho na primeira linha preenchida. */
function sheetToRows(ws) {
  // Modo denso: só as linhas que existem, mesmo quando a área usada vai até a linha 1 milhão
  const matrix = []
  for (const row of ws?.['!data'] || []) {
    if (!row) continue
    const values = []
    row.forEach((cell, c) => (values[c] = cellText(cell)))
    if (values.some((v) => v)) matrix.push(Array.from(values, (v) => v ?? ''))
  }
  if (!matrix.length) return { headers: [], rows: [] }

  const [head, ...body] = matrix
  const width = Math.max(...matrix.map((r) => r.length))
  const used = new Map()
  const headers = Array.from({ length: width }, (_, i) => {
    const base = String(head[i] ?? '').trim() || `coluna_${i + 1}`
    const n = (used.get(base) || 0) + 1
    used.set(base, n)
    return n > 1 ? `${base} (${n})` : base
  })
  // Coluna sem título e sem dado nenhum (sobra de formatação) fica de fora
  const keep = headers.map((h, i) => !/^coluna_\d+$/.test(h) || body.some((r) => r[i]))
  const kept = headers.filter((_, i) => keep[i])
  const rows = body.map((r) => Object.fromEntries(headers.flatMap((h, i) => (keep[i] ? [[h, r[i] ?? '']] : []))))
  return { headers: kept, rows }
}

/**
 * Planilha do Excel (XLS antigo ou XLSX). Cada aba com dados vira uma opção; a primeira
 * vem selecionada. A biblioteca só é baixada quando alguém escolhe uma planilha.
 */
export async function readSpreadsheetFile(file) {
  const XLSX = await import('xlsx')
  let wb
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, cellNF: true, dense: true })
  } catch {
    throw new Error('Não foi possível ler a planilha. Confira se o arquivo é .xls ou .xlsx e se não está protegido por senha.')
  }
  const sheets = wb.SheetNames.map((name) => ({ name, ...sheetToRows(wb.Sheets[name]) })).filter((sh) => sh.rows.length)
  if (!sheets.length) throw new Error('A planilha não tem linhas de dados. O cabeçalho precisa estar na primeira linha preenchida.')
  return { headers: sheets[0].headers, rows: sheets[0].rows, sheet: sheets[0].name, sheets }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Envia o arquivo em partes de 8 MB (suporta vídeos de até 512 MB).
 * Cada parte é tentada até 3 vezes; `onProgress` recebe de 0 a 1.
 */
export async function uploadFile(file, type, onProgress) {
  const { id, chunkSize } = await api.uploadInit({ fileName: file.name, mimetype: file.type, size: file.size, type })
  const total = Math.max(1, Math.ceil(file.size / chunkSize))
  for (let i = 0; i < total; i++) {
    const part = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize))
    for (let attempt = 1; ; attempt++) {
      try {
        await api.uploadChunk(id, i, part)
        break
      } catch (err) {
        if (attempt >= 3) throw err
        await wait(1000 * attempt)
      }
    }
    onProgress?.((i + 1) / total)
  }
  await api.uploadComplete(id)
  return id
}

export const formatBytes = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.ceil(bytes / 1024)} KB`

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Converte a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```) em HTML seguro. */
export function whatsappToHtml(text) {
  return escapeHtml(text)
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/(^|[\s>(])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=$|[\s<.,!?;:)])/gm, '$1<strong>$2</strong>')
    .replace(/(^|[\s>(])_(?!\s)([^_\n]+?)(?<!\s)_(?=$|[\s<.,!?;:)])/gm, '$1<em>$2</em>')
    .replace(/(^|[\s>(])~(?!\s)([^~\n]+?)(?<!\s)~(?=$|[\s<.,!?;:)])/gm, '$1<del>$2</del>')
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const s = Math.round(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}min`
  if (m) return `${m}min`
  return `${s}s`
}

/** Tempo estimado para enviar `count` mensagens com as configurações dadas. */
export function estimateSeconds(count, s) {
  if (!count) return 0
  const avg = (Number(s.minDelay) + Number(s.maxDelay)) / 2 + Number(s.typingSeconds || 0)
  const batches = s.batchSize > 0 && s.batchPause > 0 ? Math.floor((count - 1) / s.batchSize) : 0
  return (count - 1) * avg + batches * s.batchPause * 60
}

export const formatDateTime = (ts) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export const formatTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('pt-BR') : '')

/** Ex.: "sex., 10/10, 09:00" */
export const formatWhen = (ts) =>
  ts
    ? new Date(ts).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

/** Valor para <input type="datetime-local"> no horário local. */
export function toLocalInput(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Próxima hora cheia (sugestão inicial de agendamento). */
export const nextFullHour = () => {
  const d = new Date(Date.now() + 3600_000)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  } catch {
    return 'America/Sao_Paulo'
  }
}

export const formatNumber = (n) => Number(n || 0).toLocaleString('pt-BR')

export function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // armazenamento indisponível (aba anônima etc.)
  }
}
