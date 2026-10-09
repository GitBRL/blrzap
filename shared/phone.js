// Normalização de telefones — usada no navegador (prévia) e no servidor (envio).

const JID_RE = /@(g\.us|s\.whatsapp\.net|lid|newsletter)$/i

/**
 * Converte o valor da planilha para o formato aceito pela uazapi (somente dígitos,
 * com DDI). Retorna null quando o número não é válido.
 */
export function normalizePhone(raw, defaultCountry = '55') {
  if (raw === undefined || raw === null) return null
  const value = String(raw).trim()
  if (!value) return null

  // IDs completos do WhatsApp (grupos, contatos, canais) passam direto
  if (JID_RE.test(value)) return value.toLowerCase()

  // Excel em notação científica (ex.: 5.511E+12) perde dígitos — não há como recuperar
  if (/\de\+?\d/i.test(value)) return null

  const hasPlus = value.startsWith('+')
  let digits = value.replace(/\D/g, '')

  if (!hasPlus) {
    digits = digits.replace(/^0+/, '')
    const cc = String(defaultCountry || '').replace(/\D/g, '')
    if (cc === '55') {
      // DDD + número (10 ou 11 dígitos) sem o DDI
      if (digits.length === 10 || digits.length === 11) digits = '55' + digits
    } else if (cc && !digits.startsWith(cc)) {
      digits = cc + digits
    }
  }

  // Brasil: 55 + DDD + 8 ou 9 dígitos
  if (digits.startsWith('55')) return digits.length === 12 || digits.length === 13 ? digits : null
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

/**
 * Transforma as linhas do CSV em contatos, marcando inválidos e duplicados.
 * Toda linha vira um contato para que o relatório final cubra a planilha inteira.
 * `rowIndexes` traz a posição original de cada linha quando o CSV foi filtrado.
 */
export function prepareContacts(rows, phoneColumn, defaultCountry = '55', rowIndexes = null) {
  const seen = new Map()
  const contacts = rows.map((row, pos) => {
    const i = rowIndexes ? rowIndexes[pos] : pos
    const raw = row?.[phoneColumn]
    const number = normalizePhone(raw, defaultCountry)
    const contact = { i, raw: raw == null ? '' : String(raw), number, vars: row, status: 'pending', error: null }

    if (!number) {
      contact.status = 'invalid'
      contact.error = raw ? 'Número inválido' : 'Telefone vazio'
    } else if (seen.has(number)) {
      contact.status = 'skipped'
      contact.error = `Duplicado (linha ${seen.get(number) + 2})`
    } else {
      seen.set(number, i)
    }
    return contact
  })

  const stats = { total: contacts.length, valid: 0, invalid: 0, duplicates: 0 }
  for (const c of contacts) {
    if (c.status === 'pending') stats.valid++
    else if (c.status === 'invalid') stats.invalid++
    else stats.duplicates++
  }
  return { contacts, stats }
}

const PHONE_HEADER_RE = /(telefone|celular|whats|phone|fone|n[uú]mero|numero|mobile|contato|tel\b)/i

/** Tenta adivinhar qual coluna da planilha contém o telefone. */
export function detectPhoneColumn(headers, rows) {
  const byName = headers.find((h) => PHONE_HEADER_RE.test(h))
  if (byName) return byName

  const sample = rows.slice(0, 30)
  let best = null
  let bestScore = 0
  for (const h of headers) {
    const score = sample.filter((r) => normalizePhone(r[h])).length
    if (score > bestScore) {
      best = h
      bestScore = score
    }
  }
  return best ?? headers[0] ?? ''
}
