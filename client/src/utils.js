import Papa from 'papaparse'

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

export function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

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
