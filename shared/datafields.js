// Etapa de confirmação de dados do fluxo com botões — usada na prévia e no servidor.
import { normalizePhone } from './phone.js'
import { renderTemplate } from './template.js'

/** Valor especial de coluna: usa o próprio número de WhatsApp do contato. */
export const WHATSAPP_COLUMN = '__whatsapp__'

export const FIELD_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
]

export const DEFAULT_DATA_STEP = {
  enabled: true,
  intro: 'Perfeito! Para finalizarmos, confirme seus dados:',
  collectIntro: 'Perfeito! Para finalizarmos, preciso de algumas informações.',
  editIntro: 'Sem problemas! Vamos atualizar seus dados.',
  confirmLabel: 'Confirmar dados',
  editLabel: 'Alterar dados',
  fields: [
    { label: 'Nome', column: '', type: 'text', question: 'Qual é o seu nome completo?' },
    { label: 'E-mail', column: '', type: 'email', question: 'Qual é o seu melhor e-mail?' },
    { label: 'Telefone', column: WHATSAPP_COLUMN, type: 'phone', question: 'Qual é o seu telefone com DDD?' },
  ],
}

const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()

/**
 * Formata telefones brasileiros: 5511987654321 → (11) 98765-4321.
 * `withCountryCode` indica que o número já vem com DDI (caso do número de WhatsApp).
 */
export function formatPhone(value, withCountryCode = false) {
  const digits = String(value ?? '').replace(/\D/g, '')
  const isBR = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
  if (withCountryCode && !isBR) return digits ? `+${digits}` : ''
  const local = isBR ? digits.slice(2) : digits
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return digits ? `+${digits}` : ''
}

/** Valida o que o contato digitou para um campo. */
export function validateField(type, raw) {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, error: 'Não recebi nenhuma informação.' }
  if (type === 'email') {
    const email = value.toLowerCase().replace(/\s+/g, '')
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
      ? { ok: true, value: email }
      : { ok: false, error: 'Esse e-mail não parece válido. Pode enviar novamente?' }
  }
  if (type === 'phone') {
    const digits = value.replace(/\D/g, '')
    return digits.length >= 10 && digits.length <= 13
      ? { ok: true, value: formatPhone(digits) }
      : { ok: false, error: 'Não consegui identificar o telefone. Envie com DDD, por exemplo: 11 98765-4321.' }
  }
  if (value.length > 200) return { ok: false, error: 'A resposta ficou muito longa. Pode resumir?' }
  return { ok: true, value }
}

/** Valor inicial de um campo a partir da linha do CSV (ou do número de WhatsApp). */
export function prefillValue(field, vars = {}, number = '') {
  if (field.column === WHATSAPP_COLUMN) return formatPhone(number, true)
  if (!field.column) return ''
  const key = Object.keys(vars).find((k) => normalize(k) === normalize(field.column))
  const raw = key ? String(vars[key] ?? '').trim() : ''
  if (!raw) return ''
  // Só aproveita o valor do CSV se ele for válido para o tipo do campo
  const check = validateField(field.type, raw)
  return check.ok ? check.value : ''
}

/** Escolhe automaticamente a coluna do CSV de cada campo pelo nome/tipo. */
export function autoMapFields(fields, headers) {
  const known = new Set(headers)
  return fields.map((f) => {
    if (f.column === WHATSAPP_COLUMN || (f.column && known.has(f.column))) return f
    let match = ''
    if (f.type === 'email') match = headers.find((h) => /e ?mail/.test(normalize(h))) || ''
    if (!match) match = headers.find((h) => normalize(h) === normalize(f.label)) || ''
    if (!match && /^nome/.test(normalize(f.label))) match = headers.find((h) => /^(nome|name|cliente|razao social)/.test(normalize(h))) || ''
    if (!match && f.type === 'phone') return { ...f, column: WHATSAPP_COLUMN }
    return { ...f, column: match }
  })
}

/** Texto do resumo: introdução + "*Campo:* valor" por linha. */
export function summaryText(intro, fields, values) {
  const lines = fields.map((f, i) => `*${f.label}:* ${values[i] || '—'}`)
  return `${intro}\n\n${lines.join('\n')}`
}

/** Variáveis com os dados confirmados (para usar {{Nome}} etc. na mensagem final). */
export function dataVars(fields, values = []) {
  return Object.fromEntries(fields.map((f, i) => [f.label, values[i] || '']).filter(([, v]) => v))
}

// ---- Webhook de leads qualificados (ex.: Clint) ----------------------------------------

const slug = (s) => normalize(s).replace(/\s+/g, '_')

/** Mantém só caracteres seguros para nome de chave JSON. */
export const cleanKey = (k) =>
  String(k ?? '')
    .trim()
    .replace(/[^\w.-]/g, '_')
    .slice(0, 60)

/** Corpo padrão: chaves que CRMs como o Clint costumam mapear. Os valores aceitam variáveis. */
export const DEFAULT_WEBHOOK = {
  url: '',
  includeSheet: false,
  fields: [
    { key: 'name', value: '{{Nome}}' },
    { key: 'email', value: '{{E-mail}}' },
    { key: 'phone', value: '{{Telefone}}' },
    { key: 'faturamento', value: '{{faixa_faturamento}}' },
    { key: 'whatsapp', value: '{{whatsapp}}' },
    { key: 'campanha', value: '{{campanha}}' },
    { key: 'origem', value: 'Disparos WhatsApp' },
  ],
}

/** Variáveis do fluxo disponíveis para o webhook (além dos dados confirmados e das colunas do CSV). */
export const SYSTEM_VARIABLES = [
  { name: 'whatsapp', description: 'Número de WhatsApp do contato, com DDI' },
  { name: 'faixa_faturamento', description: 'Faixa de faturamento escolhida' },
  { name: 'campanha', description: 'Nome da campanha' },
  { name: 'data_confirmacao', description: 'Data e hora da confirmação (ISO 8601)' },
  { name: 'dados_alterados', description: '"sim" se o lead alterou os dados' },
]

/** Valores das variáveis para um lead. Telefones confirmados vão só com dígitos e DDI. */
export function webhookVariables({ fields = [], values = [], vars = {}, number = '', revenue = '', campaign = '', changed = false, confirmedAt }) {
  const confirmed = {}
  fields.forEach((f, i) => {
    let value = values[i] || ''
    if (f.type === 'phone' && value) value = normalizePhone(value) || value
    if (f.label) confirmed[f.label] = value
  })
  return {
    ...vars,
    ...confirmed,
    whatsapp: number,
    faixa_faturamento: revenue,
    campanha: campaign,
    data_confirmacao: new Date(confirmedAt || Date.now()).toISOString(),
    dados_alterados: changed ? 'sim' : 'não',
  }
}

/** Monta o JSON do webhook a partir da tabela chave → valor configurada na campanha. */
export function buildLeadPayload({ webhook, test = false, ...lead }) {
  const vars = webhookVariables(lead)
  const payload = {}
  for (const field of webhook?.fields || []) {
    const key = cleanKey(field.key)
    if (key) payload[key] = renderTemplate(String(field.value ?? ''), vars).trim()
  }
  if (webhook?.includeSheet) {
    for (const [k, v] of Object.entries(lead.vars || {})) {
      const key = `planilha_${slug(k) || 'coluna'}`
      if (!(key in payload)) payload[key] = v ?? ''
    }
  }
  if (test) payload.teste = true
  return payload
}
