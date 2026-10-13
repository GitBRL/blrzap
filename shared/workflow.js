// Workflows: o caminho das mensagens que seguem o disparo, montado em blocos no canvas.
// Usado na tela (editor, validação, prévia) e no servidor (validação e execução).
//
// Um workflow é um grafo: `nodes` (blocos) e `edges` (setas). Cada seta sai de uma SAÍDA
// do bloco (`sourceHandle`): um botão escolhido, "seguir", "sim"/"não" ou "sem resposta".
// Bloco sem seta numa saída encerra o caminho do contato ali.
import { activeRules, OPERATORS } from './filters.js'
import { DEFAULT_DATA_STEP, DEFAULT_WEBHOOK, FIELD_TYPES, WHATSAPP_COLUMN } from './datafields.js'

export const NODE_TYPES = {
  start: { label: 'Disparo', hint: 'A mensagem da campanha. Texto e mídia vêm da campanha; aqui ficam os botões.' },
  message: { label: 'Mensagem', hint: 'Texto (e mídia por link), com ou sem botões.' },
  question: { label: 'Pergunta aberta', hint: 'Pergunta e guarda a resposta digitada numa variável.' },
  data: { label: 'Confirmar dados', hint: 'Usa os dados da planilha, pergunta o que falta e pede confirmação.' },
  condition: { label: 'Condição', hint: 'Segue por “sim” ou “não” conforme uma regra.' },
  webhook: { label: 'Webhook', hint: 'Envia os dados do contato para uma URL (ex.: Clint).' },
}

/** Blocos que o usuário pode adicionar (o de disparo é único e já vem no workflow). */
export const ADDABLE_TYPES = ['message', 'question', 'data', 'condition', 'webhook']

export const ANSWER_TYPES = [...FIELD_TYPES, { value: 'number', label: 'Número' }]

export const LIMITS = {
  nodes: 60,
  choices: 10,
  buttons: 3, // até 3 opções viram botões; acima disso, lista
  buttonLabel: 20,
  listLabel: 24,
  text: 4000,
  webhookFields: 40,
  dataFields: 8,
  rules: 10,
  timeoutsPerContact: 5, // lembretes por contato, para um laço não mandar mensagem para sempre
}

export const TIMEOUT_UNITS = [
  { value: 'min', label: 'minutos', ms: 60_000 },
  { value: 'h', label: 'horas', ms: 3_600_000 },
  { value: 'd', label: 'dias', ms: 86_400_000 },
]
const MIN_TIMEOUT_MS = 5 * 60_000
const MAX_TIMEOUT_MS = 30 * 86_400_000

/** Prazo de "sem resposta" em ms, ou null quando desligado. */
export function timeoutMs(timeout) {
  if (!timeout?.enabled) return null
  const unit = TIMEOUT_UNITS.find((u) => u.value === timeout.unit)
  const amount = Number(timeout.amount)
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(amount * unit.ms)))
}

export function describeTimeout(timeout) {
  const unit = TIMEOUT_UNITS.find((u) => u.value === timeout?.unit)
  return timeout?.enabled && unit ? `${timeout.amount} ${unit.label}` : ''
}

const hasChoices = (node) => (node?.type === 'start' || node?.type === 'message') && node.data?.choices?.length > 0

/** O contato fica parado neste bloco esperando uma resposta? */
export const isWaiting = (node) => Boolean(node) && (node.type === 'question' || node.type === 'data' || hasChoices(node))

/** Até 3 opções vão como botões; acima disso, como lista. */
export const usesList = (node) => (node?.data?.choices?.length || 0) > LIMITS.buttons

/** As saídas do bloco, na ordem em que aparecem no canvas. */
export function outputsOf(node) {
  if (!node) return []
  const d = node.data || {}
  let outs
  switch (node.type) {
    case 'start':
    case 'message':
      outs = hasChoices(node)
        ? d.choices.map((c, i) => ({ id: `c${i}`, label: c.label || `Opção ${i + 1}` }))
        : [{ id: 'next', label: 'Seguir' }]
      break
    case 'question':
      outs = [{ id: 'next', label: 'Respondeu' }]
      break
    case 'data':
      outs = [{ id: 'next', label: 'Confirmou' }]
      break
    case 'condition':
      outs = [
        { id: 'yes', label: 'Sim' },
        { id: 'no', label: 'Não' },
      ]
      break
    default:
      outs = [{ id: 'next', label: 'Seguir' }]
  }
  if (isWaiting(node) && timeoutMs(d.timeout)) outs.push({ id: 'timeout', label: `Sem resposta (${describeTimeout(d.timeout)})` })
  return outs
}

export const nodeById = (wf, id) => wf?.nodes?.find((n) => n.id === id) || null
export const startNode = (wf) => wf?.nodes?.find((n) => n.type === 'start') || null

/** Destino da seta que sai de `handle` do bloco `nodeId`, ou null (fim do caminho). */
export function nextOf(wf, nodeId, handle) {
  return wf?.edges?.find((e) => e.source === nodeId && (e.sourceHandle || 'next') === handle)?.target || null
}

/** Nome de variável: sem chaves, barra vertical ou quebra de linha. */
export const cleanVarName = (s) =>
  String(s ?? '')
    .replace(/[{}|\r\n]+/g, '')
    .trim()
    .slice(0, 40)

/** Variáveis que o workflow cria (respostas guardadas e dados confirmados). */
export function savedVariables(wf) {
  const out = []
  const add = (name, from) => {
    if (name && !out.some((v) => v.name === name)) out.push({ name, from })
  }
  for (const n of wf?.nodes || []) {
    const title = n.data?.title || NODE_TYPES[n.type]?.label
    if ((n.type === 'start' || n.type === 'message' || n.type === 'question') && n.data?.saveAs) add(n.data.saveAs, title)
    if (n.type === 'data') {
      for (const f of n.data?.fields || []) add(f.label, title)
      add('data_confirmacao', title)
      add('dados_alterados', title)
    }
  }
  return out
}

/** Variáveis do sistema, disponíveis em qualquer texto do workflow. */
export const SYSTEM_VARS = [
  { name: 'whatsapp', description: 'Número de WhatsApp do contato, com DDI' },
  { name: 'campanha', description: 'Nome da campanha' },
]

/** Etiquetas usadas nas opções (ex.: "Qualificado") — viram contagem e filtro nos resultados. */
export function tagsOf(wf) {
  const tags = new Set()
  for (const n of wf?.nodes || []) for (const c of n.data?.choices || []) if (c.tag) tags.add(c.tag)
  return [...tags]
}

// ---- Validação --------------------------------------------------------------------------

const isUrl = (s) => /^https?:\/\/[^\s/]+/i.test(String(s || '').trim())
const nodeName = (n) => `“${n.data?.title || NODE_TYPES[n.type]?.label || n.type}”`

/** Problemas que impedem usar o workflow numa campanha. Mesma regra na tela e no servidor. */
export function workflowProblems(wf) {
  const out = []
  if (!wf || !Array.isArray(wf.nodes) || !Array.isArray(wf.edges)) return ['Workflow inválido.']
  if (!String(wf.name || '').trim()) out.push('Dê um nome ao workflow.')
  const starts = wf.nodes.filter((n) => n.type === 'start')
  if (starts.length !== 1) out.push('O workflow precisa de exatamente um bloco de disparo.')
  if (wf.nodes.length > LIMITS.nodes) out.push(`Use no máximo ${LIMITS.nodes} blocos.`)

  for (const n of wf.nodes) {
    const d = n.data || {}
    const name = nodeName(n)
    if (n.type === 'start' || n.type === 'message') {
      const choices = d.choices || []
      // Botões e listas não saem sem texto na uazapi; sem botões, a mídia sozinha basta
      if (n.type === 'message' && !String(d.text || '').trim() && (choices.length || !d.media?.url)) {
        out.push(`${name}: escreva o texto da mensagem.`)
      }
      if (choices.length > LIMITS.choices) out.push(`${name}: use no máximo ${LIMITS.choices} opções.`)
      if (choices.some((c) => !String(c.label || '').trim())) out.push(`${name}: preencha o texto de todas as opções.`)
      const max = choices.length > LIMITS.buttons ? LIMITS.listLabel : LIMITS.buttonLabel
      if (choices.some((c) => String(c.label || '').length > max)) out.push(`${name}: o texto das opções tem no máximo ${max} caracteres.`)
      if (d.media?.url && !isUrl(d.media.url)) out.push(`${name}: o link da mídia precisa começar com http:// ou https://.`)
    }
    if (n.type === 'question') {
      if (!String(d.text || '').trim()) out.push(`${name}: escreva a pergunta.`)
      if (!cleanVarName(d.saveAs)) out.push(`${name}: diga em que variável guardar a resposta.`)
    }
    if (n.type === 'data') {
      const fields = (d.fields || []).filter((f) => String(f.label || '').trim())
      if (!fields.length) out.push(`${name}: adicione pelo menos um dado.`)
      if (fields.length > LIMITS.dataFields) out.push(`${name}: use no máximo ${LIMITS.dataFields} dados.`)
      if (fields.some((f) => !String(f.question || '').trim())) out.push(`${name}: escreva a pergunta de cada dado.`)
      if (!String(d.confirmLabel || '').trim() || !String(d.editLabel || '').trim()) out.push(`${name}: preencha os botões de confirmar e alterar.`)
    }
    if (n.type === 'condition' && !activeRules(d).length) out.push(`${name}: complete pelo menos uma regra.`)
    if (n.type === 'webhook') {
      if (!isUrl(d.url)) out.push(`${name}: informe a URL (http:// ou https://).`)
      else if (!(d.fields || []).some((f) => String(f.key || '').trim()) && !d.includeSheet) out.push(`${name}: adicione pelo menos um dado para enviar.`)
    }
    if (isWaiting(n) && d.timeout?.enabled && !timeoutMs(d.timeout)) out.push(`${name}: informe o prazo de “sem resposta”.`)
  }

  const ids = new Set(wf.nodes.map((n) => n.id))
  const seenHandles = new Set()
  for (const e of wf.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      out.push('Há uma seta ligada a um bloco que não existe mais.')
      continue
    }
    const key = `${e.source}:${e.sourceHandle || 'next'}`
    if (seenHandles.has(key)) out.push(`${nodeName(nodeById(wf, e.source))}: uma saída só pode levar a um bloco.`)
    seenHandles.add(key)
    if (nodeById(wf, e.target)?.type === 'start') out.push('Nenhuma seta pode voltar para o bloco de disparo.')
  }

  // Laço sem nenhuma pergunta no meio: o contato rodaria para sempre sem responder nada
  if (hasInstantLoop(wf)) out.push('Há um laço sem nenhum bloco que espere resposta. Inclua uma pergunta no caminho.')
  return [...new Set(out)]
}

/** Ciclo formado só por blocos que não esperam resposta (mensagem sem botões, condição, webhook). */
function hasInstantLoop(wf) {
  const instant = new Set(wf.nodes.filter((n) => !isWaiting(n)).map((n) => n.id))
  const adj = new Map()
  for (const e of wf.edges) {
    if (!instant.has(e.source) || !instant.has(e.target)) continue
    adj.set(e.source, [...(adj.get(e.source) || []), e.target])
  }
  const state = new Map() // 1 = visitando, 2 = concluído
  const visit = (id) => {
    if (state.get(id) === 1) return true
    if (state.get(id) === 2) return false
    state.set(id, 1)
    for (const next of adj.get(id) || []) if (visit(next)) return true
    state.set(id, 2)
    return false
  }
  return [...instant].some((id) => visit(id))
}

/** Avisos que não impedem o uso (blocos soltos). */
export function workflowWarnings(wf) {
  const start = startNode(wf)
  if (!start) return []
  const reached = new Set([start.id])
  const queue = [start.id]
  while (queue.length) {
    const id = queue.shift()
    for (const e of wf.edges) {
      if (e.source === id && !reached.has(e.target)) {
        reached.add(e.target)
        queue.push(e.target)
      }
    }
  }
  const loose = wf.nodes.filter((n) => !reached.has(n.id))
  return loose.length ? [`${loose.length === 1 ? 'Um bloco não é alcançado' : `${loose.length} blocos não são alcançados`} a partir do disparo.`] : []
}

// ---- Limpeza (servidor) -----------------------------------------------------------------

const str = (v, max) => String(v ?? '').slice(0, max)
const label = (v, max) =>
  String(v ?? '')
    .replace(/[|\r\n]+/g, ' ')
    .trim()
    .slice(0, max)
const NODE_ID_RE = /^[a-z][a-z0-9]{0,11}$/
const OPS = new Set(OPERATORS.map((o) => o.value))
const ANSWER_TYPE_SET = new Set(ANSWER_TYPES.map((t) => t.value))
const FIELD_TYPE_SET = new Set(FIELD_TYPES.map((t) => t.value))
const MEDIA_TYPES = new Set(['image', 'video', 'document', 'audio'])

function cleanTimeout(t) {
  const unit = TIMEOUT_UNITS.some((u) => u.value === t?.unit) ? t.unit : 'h'
  const amount = Math.max(0, Math.min(999, Number(t?.amount) || 0))
  return { enabled: Boolean(t?.enabled), amount, unit }
}

function cleanChoices(list) {
  return (Array.isArray(list) ? list : []).slice(0, LIMITS.choices).map((c) => ({
    label: label(c?.label, LIMITS.listLabel),
    tag: label(c?.tag, 30),
  }))
}

function cleanData(type, d = {}) {
  const title = label(d.title, 40)
  switch (type) {
    case 'start':
      return { title, choices: cleanChoices(d.choices), footer: label(d.footer, 60), listButton: label(d.listButton, 20), saveAs: cleanVarName(d.saveAs), timeout: cleanTimeout(d.timeout) }
    case 'message': {
      const media = d.media?.url ? { type: MEDIA_TYPES.has(d.media.type) ? d.media.type : 'image', url: str(d.media.url, 2000).trim(), fileName: label(d.media.fileName, 120) } : null
      return { title, text: str(d.text, LIMITS.text), media, choices: cleanChoices(d.choices), footer: label(d.footer, 60), listButton: label(d.listButton, 20), saveAs: cleanVarName(d.saveAs), timeout: cleanTimeout(d.timeout) }
    }
    case 'question':
      return { title, text: str(d.text, LIMITS.text), saveAs: cleanVarName(d.saveAs), answerType: ANSWER_TYPE_SET.has(d.answerType) ? d.answerType : 'text', invalidText: str(d.invalidText, 500), timeout: cleanTimeout(d.timeout) }
    case 'data':
      return {
        title,
        intro: str(d.intro, 1000),
        collectIntro: str(d.collectIntro, 1000),
        editIntro: str(d.editIntro, 1000),
        confirmLabel: label(d.confirmLabel, LIMITS.buttonLabel),
        editLabel: label(d.editLabel, LIMITS.buttonLabel),
        fields: (Array.isArray(d.fields) ? d.fields : []).slice(0, LIMITS.dataFields).map((f) => ({
          label: label(f?.label, 30),
          column: str(f?.column, 200),
          type: FIELD_TYPE_SET.has(f?.type) ? f.type : 'text',
          question: str(f?.question, 1000),
        })),
        timeout: cleanTimeout(d.timeout),
      }
    case 'condition':
      return {
        title,
        match: d.match === 'any' ? 'any' : 'all',
        rules: (Array.isArray(d.rules) ? d.rules : []).slice(0, LIMITS.rules).map((r) => ({
          column: cleanVarName(r?.column),
          op: OPS.has(r?.op) ? r.op : 'eq',
          value: str(r?.value, 200),
        })),
      }
    case 'webhook':
      return {
        title,
        url: str(d.url, 2000).trim(),
        includeSheet: Boolean(d.includeSheet),
        fields: (Array.isArray(d.fields) ? d.fields : []).slice(0, LIMITS.webhookFields).map((f) => ({
          key: String(f?.key ?? '').trim().replace(/[^\w.-]/g, '_').slice(0, 60),
          value: str(f?.value, 1000),
        })),
      }
    default:
      return { title }
  }
}

/** Mantém só a estrutura conhecida, com limites de tamanho. Não valida regras de negócio. */
export function cleanWorkflow(input = {}) {
  const nodes = []
  const ids = new Set()
  for (const n of Array.isArray(input.nodes) ? input.nodes.slice(0, LIMITS.nodes + 5) : []) {
    if (!NODE_TYPES[n?.type] || !NODE_ID_RE.test(String(n?.id || '')) || ids.has(n.id)) continue
    ids.add(n.id)
    nodes.push({
      id: n.id,
      type: n.type,
      position: { x: Math.round(Number(n.position?.x) || 0), y: Math.round(Number(n.position?.y) || 0) },
      data: cleanData(n.type, n.data),
    })
  }
  const edges = []
  for (const e of Array.isArray(input.edges) ? input.edges.slice(0, 400) : []) {
    if (!ids.has(e?.source) || !ids.has(e?.target)) continue
    const sourceHandle = /^(next|yes|no|timeout|c\d{1,2})$/.test(String(e.sourceHandle || 'next')) ? e.sourceHandle || 'next' : 'next'
    edges.push({ id: `e-${e.source}-${sourceHandle}-${e.target}`, source: e.source, sourceHandle, target: e.target })
  }
  return {
    name: label(input.name, 80),
    description: str(input.description, 300).trim(),
    nodes,
    edges,
  }
}

// ---- Blocos novos ----------------------------------------------------------------------

export function defaultNodeData(type) {
  const timeout = { enabled: false, amount: 24, unit: 'h' }
  switch (type) {
    case 'start':
      return { title: '', choices: [], footer: '', listButton: 'Ver opções', saveAs: '', timeout }
    case 'message':
      return { title: '', text: '', media: null, choices: [], footer: '', listButton: 'Ver opções', saveAs: '', timeout }
    case 'question':
      return { title: '', text: '', saveAs: '', answerType: 'text', invalidText: '', timeout }
    case 'data':
      return { title: '', ...structuredClone(DEFAULT_DATA_STEP), enabled: undefined, timeout }
    case 'condition':
      return { title: '', match: 'all', rules: [{ column: '', op: 'gt', value: '' }] }
    case 'webhook':
      return { title: '', url: '', includeSheet: false, fields: DEFAULT_WEBHOOK.fields.map((f) => ({ ...f })) }
    default:
      return { title: '' }
  }
}

/** Próximo id livre: n1, n2, … (curto, porque vai dentro do ID dos botões). */
export function nextNodeId(wf) {
  let max = 0
  for (const n of wf?.nodes || []) {
    const m = /^n(\d+)$/.exec(n.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `n${max + 1}`
}

export function emptyWorkflow(name = 'Novo workflow') {
  return {
    name,
    description: '',
    nodes: [{ id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: defaultNodeData('start') }],
    edges: [],
  }
}

// ---- O fluxo antigo "botões de interesse", como template ---------------------------------

/** Os textos do fluxo de qualificação que existia antes dos workflows. */
export const LEGACY_FLOW_DEFAULTS = {
  buttons: { yes: 'Tenho interesse', no: 'Não tenho interesse' },
  footer: '',
  question: 'Que ótimo! Para indicarmos a melhor solução para você, qual é o faturamento mensal da sua empresa?',
  listButton: 'Ver faixas',
  options: [
    { label: 'Até R$ 20 mil', qualified: false },
    { label: 'R$ 20 mil a R$ 50 mil', qualified: false },
    { label: 'R$ 50 mil a R$ 80 mil', qualified: false },
    { label: 'Acima de R$ 80 mil', qualified: true },
  ],
  dataStep: DEFAULT_DATA_STEP,
  webhook: DEFAULT_WEBHOOK,
  replies: {
    qualified: 'Obrigado, {{Nome}}! Seus dados foram confirmados. Um dos nossos especialistas vai entrar em contato com você em breve. 🚀',
    notQualified:
      'Muito obrigado pelo interesse e pelas informações! 🙏\n\n' +
      'Com base no que você compartilhou, infelizmente não seguiremos com uma proposta neste momento: nossa solução hoje é voltada para empresas em outro estágio de faturamento.\n\n' +
      'Vamos manter seu contato e, se surgir uma opção adequada ao momento da sua empresa, retornaremos. Desejamos muito sucesso!',
    noInterest: 'Tudo bem, obrigado pelo retorno! 🙂',
  },
}

/**
 * Remonta o fluxo "botões de interesse" com os blocos do workflow: disparo com os dois
 * botões → pergunta de faturamento → (qualificado) confirmação de dados → webhook → final;
 * (não qualificado) recusa; (sem interesse) agradecimento.
 */
export function legacyFlowToWorkflow(flow = LEGACY_FLOW_DEFAULTS, name = 'Qualificação por faturamento') {
  const f = { ...LEGACY_FLOW_DEFAULTS, ...flow }
  const nodes = []
  const edges = []
  const add = (id, type, x, y, data) => nodes.push({ id, type, position: { x, y }, data: { ...defaultNodeData(type), ...data } })
  const link = (source, sourceHandle, target) => target && edges.push({ id: `e-${source}-${sourceHandle}-${target}`, source, sourceHandle, target })

  add('n1', 'start', 0, 0, {
    title: 'Mensagem com botões',
    choices: [
      { label: f.buttons.yes, tag: 'Interessado' },
      { label: f.buttons.no, tag: 'Sem interesse' },
    ],
    footer: f.footer || '',
    saveAs: 'interesse',
  })
  // Grade de 330 px por coluna: cabe numa tela sem precisar afastar demais o zoom
  add('n2', 'message', 330, -60, {
    title: 'Faturamento',
    text: f.question,
    choices: f.options.map((o) => ({ label: o.label, tag: o.qualified ? 'Qualificado' : 'Não qualificado' })),
    listButton: f.listButton || 'Ver opções',
    saveAs: 'faixa_faturamento',
  })
  const ds = f.dataStep?.enabled === false ? null : f.dataStep
  if (ds) {
    const { enabled: _enabled, ...rest } = ds
    add('n3', 'data', 660, -230, { title: 'Confirmação de dados', ...structuredClone(rest) })
  }
  if (f.webhook?.url) add('n4', 'webhook', 990, -230, { title: 'Enviar lead', ...structuredClone(f.webhook) })
  if (f.replies.qualified) add('n5', 'message', 990, f.webhook?.url ? -40 : -230, { title: 'Mensagem final', text: f.replies.qualified })
  if (f.replies.notQualified) add('n6', 'message', 660, 130, { title: 'Recusa', text: f.replies.notQualified })
  if (f.replies.noInterest) add('n7', 'message', 330, 260, { title: 'Sem interesse', text: f.replies.noInterest })

  const has = (id) => nodes.some((n) => n.id === id)
  const afterQualified = ['n3', 'n4', 'n5'].find(has) || null
  link('n1', 'c0', 'n2')
  link('n1', 'c1', has('n7') ? 'n7' : null)
  f.options.forEach((o, i) => link('n2', `c${i}`, o.qualified ? afterQualified : has('n6') ? 'n6' : null))
  if (has('n3')) link('n3', 'next', ['n4', 'n5'].find(has) || null)
  if (has('n4')) link('n4', 'next', has('n5') ? 'n5' : null)

  return {
    name,
    description: 'Botões de interesse, pergunta de faturamento, confirmação de dados do lead qualificado e mensagem final.',
    nodes,
    edges,
  }
}

export { WHATSAPP_COLUMN }
