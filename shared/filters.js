// Filtros de linhas do CSV — usados no navegador (prévia) e no servidor (criação da campanha).

export const OPERATORS = [
  { value: 'gt', label: 'maior que', numeric: true },
  { value: 'gte', label: 'maior ou igual a', numeric: true },
  { value: 'lt', label: 'menor que', numeric: true },
  { value: 'lte', label: 'menor ou igual a', numeric: true },
  { value: 'eq', label: 'igual a' },
  { value: 'neq', label: 'diferente de' },
  { value: 'contains', label: 'contém' },
  { value: 'not_contains', label: 'não contém' },
  { value: 'empty', label: 'está vazio', noValue: true },
  { value: 'not_empty', label: 'não está vazio', noValue: true },
]

const OPS = Object.fromEntries(OPERATORS.map((o) => [o.value, o]))

const normalizeText = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

/**
 * Converte valores escritos à brasileira em número:
 * "R$ 80.000,00" → 80000 · "80 mil" → 80000 · "80k" → 80000 · "1,5 mi" → 1500000
 */
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = normalizeText(value)
  if (!text) return null

  let multiplier = 1
  if (/\d\s*(mi|mm|milhao|milhoes)\b/.test(text)) multiplier = 1e6
  else if (/\d\s*(mil|k)\b/.test(text)) multiplier = 1e3

  let s = text.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // Os dois separadores: o último é o decimal
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // Só vírgula: decimal no padrão brasileiro (exceto "1,234,567")
    s = (s.match(/,/g).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'))
  } else if (lastDot > -1) {
    // Só ponto: "80.000" e "1.200.000" são milhar; "80.5" é decimal
    const parts = s.split('.')
    if (parts.length > 2 || parts.at(-1).length === 3) s = s.replace(/\./g, '')
  }

  const n = parseFloat(s)
  return Number.isFinite(n) ? n * multiplier : null
}

function matchRule(row, { column, op, value }) {
  const cell = row?.[column]
  const def = OPS[op]
  if (!def) return true

  if (op === 'empty') return normalizeText(cell) === ''
  if (op === 'not_empty') return normalizeText(cell) !== ''

  if (def.numeric) {
    const a = parseNumber(cell)
    const b = parseNumber(value)
    if (a === null || b === null) return false
    return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
  }

  if (op === 'eq' || op === 'neq') {
    const a = parseNumber(cell)
    const b = parseNumber(value)
    const equal = a !== null && b !== null ? a === b : normalizeText(cell) === normalizeText(value)
    return op === 'eq' ? equal : !equal
  }

  const contains = normalizeText(cell).includes(normalizeText(value))
  return op === 'contains' ? contains : !contains
}

/** Regras incompletas (sem coluna, ou sem valor quando o operador exige) são ignoradas. */
export function activeRules(filters) {
  return (filters?.rules || []).filter((r) => r.column && OPS[r.op] && (OPS[r.op].noValue || String(r.value ?? '').trim()))
}

export function rowMatches(row, filters) {
  const rules = activeRules(filters)
  if (!rules.length) return true
  return filters.match === 'any' ? rules.some((r) => matchRule(row, r)) : rules.every((r) => matchRule(row, r))
}

/** Retorna as linhas que passam no filtro e o índice original de cada uma. */
export function applyFilters(rows, filters) {
  const kept = []
  const indexes = []
  rows.forEach((row, i) => {
    if (rowMatches(row, filters)) {
      kept.push(row)
      indexes.push(i)
    }
  })
  return { rows: kept, indexes }
}

export function describeFilters(filters) {
  const rules = activeRules(filters)
  if (!rules.length) return ''
  const parts = rules.map((r) => `${r.column} ${OPS[r.op].label}${OPS[r.op].noValue ? '' : ` ${r.value}`}`)
  return parts.join(filters.match === 'any' ? ' OU ' : ' E ')
}
