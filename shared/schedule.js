// Agendamento e janela de envio — usados no navegador (estimativas) e no servidor (execução).
// Os horários da janela são interpretados no fuso horário salvo na campanha.

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'
export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

export const DEFAULT_WINDOW = { enabled: false, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }

const formatters = new Map()
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      }),
    )
  }
  return formatters.get(timeZone)
}

export function isValidTimeZone(tz) {
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

/** Data/hora "de parede" de um instante no fuso informado. */
export function zonedParts(ts, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(ts).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: EN_WEEKDAYS.indexOf(p.weekday) }
}

/** Instante (ms) correspondente a uma data/hora "de parede" no fuso informado. */
export function zonedToUtc(y, m, d, h, mi, timeZone) {
  const target = Date.UTC(y, m - 1, d, h, mi)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timeZone)
    const diff = target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
    if (!diff) break
    guess += diff
  }
  return guess
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

const tzOf = (w) => w.timeZone || DEFAULT_TIMEZONE

export function isWithinWindow(ts, w) {
  if (!w?.enabled) return true
  const p = zonedParts(ts, tzOf(w))
  const minutes = p.h * 60 + p.mi
  return w.days.includes(p.wd) && minutes >= toMinutes(w.start) && minutes < toMinutes(w.end)
}

/** Próximo instante em que a janela abre (o próprio `ts` se já estiver dentro). */
export function nextWindowStart(ts, w) {
  if (!w?.enabled || isWithinWindow(ts, w)) return ts
  const tz = tzOf(w)
  const [sh, sm] = w.start.split(':').map(Number)
  for (let i = 0; i <= 8; i++) {
    const p = zonedParts(ts + i * DAY_MS, tz)
    if (!w.days.includes(p.wd)) continue
    const start = zonedToUtc(p.y, p.m, p.d, sh, sm, tz)
    if (start > ts) return start
  }
  return null
}

/** Fim da janela em andamento (supõe `ts` dentro da janela). */
function currentWindowEnd(ts, w) {
  const tz = tzOf(w)
  const p = zonedParts(ts, tz)
  const [eh, em] = w.end.split(':').map(Number)
  return zonedToUtc(p.y, p.m, p.d, eh, em, tz)
}

/** Previsão de término para `seconds` de envio contínuo começando em `startTs`. */
export function estimateFinish(startTs, seconds, w) {
  let remaining = seconds * 1000
  if (!w?.enabled) return startTs + remaining
  let t = nextWindowStart(startTs, w)
  for (let i = 0; t !== null && i < 400; i++) {
    const end = currentWindowEnd(t, w)
    if (remaining <= end - t) return t + remaining
    remaining -= end - t
    t = nextWindowStart(end, w)
  }
  return null
}

/** Valida a janela vinda da tela. Retorna a versão normalizada ou lança erro com mensagem. */
export function normalizeWindow(input, timeZone) {
  if (!input?.enabled) return { ...DEFAULT_WINDOW, enabled: false }
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!hhmm.test(input.start) || !hhmm.test(input.end)) throw new Error('Horário da janela inválido (use HH:MM).')
  if (toMinutes(input.end) <= toMinutes(input.start)) throw new Error('O fim da janela de envio deve ser depois do início.')
  const days = [...new Set((input.days || []).map(Number))].filter((d) => d >= 0 && d <= 6).sort()
  if (!days.length) throw new Error('Escolha pelo menos um dia da semana para a janela de envio.')
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE
  return { enabled: true, start: input.start, end: input.end, days, timeZone: tz }
}

export function describeWindow(w) {
  if (!w?.enabled) return ''
  const days = w.days.length === 7 ? 'todos os dias' : w.days.map((d) => WEEKDAYS[d]).join(', ')
  return `${days}, das ${w.start} às ${w.end}`
}
