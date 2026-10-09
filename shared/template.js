// Templates de mensagem — usados no navegador (prévia) e no servidor (envio).
//
// Sintaxe suportada:
//   {{coluna}}              valor da coluna do CSV (sem diferenciar maiúsculas/minúsculas)
//   {{coluna|padrão}}       usa "padrão" quando a coluna estiver vazia
//   {Olá|Oi|E aí}           spintax: escolhe uma opção aleatória por contato

const VAR_RE = /\{\{\s*([^{}|]+?)\s*(?:\|([^{}]*))?\}\}/g
const SPIN_RE = /\{([^{}]*\|[^{}]*)\}/

const keyOf = (k) => String(k).trim().toLowerCase()

/** Nomes de variáveis usadas no template, sem repetição. */
export function extractVariables(template = '') {
  const names = new Set()
  for (const m of template.matchAll(VAR_RE)) names.add(m[1].trim())
  return [...names]
}

/** Variáveis do template que não existem entre as colunas do CSV. */
export function missingVariables(template, headers = []) {
  const known = new Set(headers.map(keyOf))
  return extractVariables(template).filter((v) => !known.has(keyOf(v)))
}

export function hasSpintax(template = '') {
  return SPIN_RE.test(template.replace(VAR_RE, ''))
}

/** Gera o texto final para um contato. */
export function renderTemplate(template = '', vars = {}, random = Math.random) {
  const lookup = {}
  for (const [k, v] of Object.entries(vars || {})) lookup[keyOf(k)] = v

  let out = template.replace(VAR_RE, (_, name, fallback) => {
    const value = lookup[keyOf(name)]
    const text = value === undefined || value === null ? '' : String(value).trim()
    return text || (fallback ?? '').trim()
  })

  // Resolve spintax de dentro para fora (permite aninhamento)
  for (let guard = 0, m; (m = SPIN_RE.exec(out)) && guard < 1000; guard++) {
    const options = m[1].split('|')
    const pick = options[Math.floor(random() * options.length)]
    out = out.slice(0, m.index) + pick + out.slice(m.index + m[0].length)
  }

  return out
}
