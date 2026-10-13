// Régua de cobrança — definições usadas no navegador (telas e prévias) e no servidor (execução).
import { parseNumber } from './filters.js'
import { DEFAULT_TIMEZONE, zonedParts } from './schedule.js'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/**
 * Etapas padrão (marcos contados a partir do vencimento, D0).
 * call.attempts: tentativas registradas na tarefa de ligação antes da mensagem.
 */
export const DEFAULT_STAGES = [
  {
    key: 'd-7',
    offset: -7,
    name: 'Envio do boleto',
    phase: 'preventiva',
    objective: 'Serviço e organização. O cliente recebe o boleto e o link de pagamento com antecedência.',
    enabled: true,
    call: { enabled: false, attempts: [] },
    whatsapp: {
      enabled: true,
      variants: [
        'Olá, {{nome}}! Tudo bem? 😊\n\nSeu boleto de *{{valor}}*, com vencimento em *{{vencimento}}*, já está disponível.\n\n📄 Boleto: {{link_boleto}}\n💳 Pagar online: {{link_pagamento}}\n\nQualquer dúvida, é só responder esta mensagem.',
      ],
    },
    email: {
      enabled: true,
      subject: 'Seu boleto de {{valor}} — vencimento em {{vencimento}}',
      body: 'Olá, {{nome}}!\n\nSeu boleto de {{valor}}, com vencimento em {{vencimento}}, já está disponível.\n\nBoleto: {{link_boleto}}\nPagar online: {{link_pagamento}}\n\nQualquer dúvida, estamos à disposição.',
      attachBoleto: true,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd-3',
    offset: -3,
    name: 'Lembrete preventivo',
    phase: 'preventiva',
    objective: 'Lembrete leve do vencimento próximo.',
    enabled: true,
    call: { enabled: false, attempts: [] },
    whatsapp: {
      enabled: true,
      variants: [
        'Oi, {{nome}}! Passando para lembrar que seu boleto de *{{valor}}* vence em *{{vencimento}}*.\n\nSe já estiver tudo organizado, pode desconsiderar. 😉\n{{link_pagamento}}',
      ],
    },
    email: {
      enabled: true,
      subject: 'Lembrete: seu boleto vence em {{vencimento}}',
      body: 'Olá, {{nome}}!\n\nPassando para lembrar que o seu boleto de {{valor}} vence em {{vencimento}}.\n\nBoleto: {{link_boleto}}\nPagar online: {{link_pagamento}}\n\nSe já estiver tudo certo, pode desconsiderar este e-mail.',
      attachBoleto: false,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd0',
    offset: 0,
    name: 'Dia do vencimento',
    phase: 'preventiva',
    objective: 'Aviso de que o título vence hoje, com Pix e link de pagamento na mensagem.',
    enabled: true,
    call: { enabled: false, attempts: [] },
    whatsapp: {
      enabled: true,
      variants: [
        'Olá, {{nome}}! Seu título de *{{valor}}* vence *hoje* ({{vencimento}}).\n\nPara pagar agora via Pix, copie o código abaixo:\n{{pix|(peça o código Pix respondendo esta mensagem)}}\n\nOu pague pelo link: {{link_pagamento}}',
      ],
    },
    email: { enabled: false, subject: '', body: '', attachBoleto: false },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+3',
    offset: 3,
    name: 'Lembrete de pagamento',
    phase: 'recuperacao',
    objective: 'Lembrete cordial. Assume esquecimento, sem tom de cobrança.',
    enabled: true,
    call: { enabled: false, attempts: [] },
    whatsapp: {
      enabled: true,
      variants: [
        'Oi, {{nome}}! Tudo certo? Notamos que o boleto de *{{valor}}*, vencido em {{vencimento}}, ainda está em aberto por aqui. Pode ter sido só um esquecimento 🙂\n\nSegue o link para facilitar: {{link_pagamento}}',
        'Olá, {{nome}}! Só um lembrete rápido: o pagamento de *{{valor}}* (vencimento em {{vencimento}}) ainda não apareceu no nosso sistema. Se já pagou, pode desconsiderar.\n\nLink para pagamento: {{link_pagamento}}',
        '{{nome}}, tudo bem? O boleto de *{{valor}}* venceu em {{vencimento}}. Se precisar da 2ª via, é só usar este link: {{link_pagamento}}\n\nQualquer coisa, estamos por aqui!',
      ],
    },
    email: {
      enabled: true,
      subject: 'Lembrete de pagamento — {{valor}}',
      body: 'Olá, {{nome}}!\n\nNotamos que o boleto de {{valor}}, vencido em {{vencimento}}, ainda está em aberto. Pode ter sido apenas um esquecimento.\n\nPara facilitar, segue o link: {{link_pagamento}}\nBoleto: {{link_boleto}}\n\nSe o pagamento já foi feito, por favor desconsidere esta mensagem.',
      attachBoleto: false,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+5',
    offset: 5,
    name: 'Aproximação',
    phase: 'recuperacao',
    objective: 'Entendimento e resolução. Solicita informação sobre o apontamento do pagamento.',
    enabled: true,
    call: { enabled: false, attempts: [] },
    whatsapp: {
      enabled: true,
      variants: [
        'Olá, {{nome}}. Ainda não identificamos o pagamento de *{{valor}}*, vencido em {{vencimento}} ({{dias_atraso}} dias).\n\nAconteceu algum imprevisto? Se já pagou, pode nos enviar o comprovante por aqui para darmos baixa. Se precisar, podemos te ajudar a encontrar a melhor forma de regularizar.',
      ],
    },
    email: { enabled: false, subject: '', body: '', attachBoleto: false },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+7',
    offset: 7,
    name: 'Plano de execução da dívida',
    phase: 'recuperacao',
    objective: 'Compromisso. Extrair promessa de pagamento com data definida.',
    enabled: true,
    call: { enabled: true, attempts: ['phone', 'whatsapp'] },
    whatsapp: {
      enabled: true,
      variants: [
        'Olá, {{nome}}. Tentamos falar com você sobre o título de *{{valor}}*, em aberto há {{dias_atraso}} dias.\n\nPara evitarmos as próximas etapas de cobrança, pode nos informar *em qual data* consegue realizar o pagamento?\n\nLink para pagamento: {{link_pagamento}}',
      ],
    },
    email: {
      enabled: true,
      subject: 'Título em aberto — {{valor}}',
      body: 'Olá, {{nome}}.\n\nO título de {{valor}}, vencido em {{vencimento}}, está em aberto há {{dias_atraso}} dias. Segue a 2ª via para regularização:\n\nBoleto: {{link_boleto}}\nPagar online: {{link_pagamento}}\n\nSe preferir, responda este e-mail informando a data em que consegue realizar o pagamento.',
      attachBoleto: true,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+15',
    offset: 15,
    name: 'Alerta de protesto',
    phase: 'recuperacao',
    objective: 'Preocupação e resolução. Comunica o protesto automático em D+30 e valida o dossiê de cobrança.',
    enabled: true,
    call: { enabled: true, attempts: ['phone', 'whatsapp'] },
    whatsapp: {
      enabled: true,
      variants: [
        '{{nome}}, o título de *{{valor}}* está em aberto há {{dias_atraso}} dias.\n\nInformamos que títulos não regularizados são *encaminhados automaticamente a protesto com 30 dias de atraso* ({{data_protesto}}).\n\nQueremos resolver isso com você antes: responda esta mensagem ou pague pelo link {{link_pagamento}}',
      ],
    },
    email: {
      enabled: true,
      subject: 'Aviso importante: protesto automático em {{data_protesto}}',
      body: 'Olá, {{nome}}.\n\nO título de {{valor}}, vencido em {{vencimento}}, está em aberto há {{dias_atraso}} dias. Títulos não regularizados são encaminhados automaticamente a protesto com 30 dias de atraso, em {{data_protesto}}.\n\nPara regularizar: {{link_pagamento}}\nBoleto: {{link_boleto}}\n\nEstamos à disposição para encontrar a melhor solução.',
      attachBoleto: true,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+30',
    offset: 30,
    name: 'Prazo limite e protesto',
    phase: 'recuperacao',
    objective: 'Urgência factual. Último dia antes do protesto, realizado às 12h. Suspensão de eventos e formações presenciais.',
    enabled: true,
    call: { enabled: true, attempts: ['phone', 'whatsapp'] },
    whatsapp: {
      enabled: true,
      variants: [
        '{{nome}}, hoje é o *último dia* para regularizar o título de *{{valor}}* antes do protesto, que será realizado *hoje às 12h*.\n\nA participação em eventos e formações presenciais fica suspensa até a regularização.\n\nPague agora: {{link_pagamento}}',
      ],
    },
    email: {
      enabled: true,
      subject: 'Último dia antes do protesto — {{valor}}',
      body: 'Olá, {{nome}}.\n\nHoje é o último dia para regularizar o título de {{valor}}, vencido em {{vencimento}}, antes do protesto, que será realizado hoje às 12h. A participação em eventos e formações presenciais fica suspensa até a regularização.\n\nPagar agora: {{link_pagamento}}\nBoleto: {{link_boleto}}',
      attachBoleto: true,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+45',
    offset: 45,
    name: 'Negociação pós-protesto',
    phase: 'recuperacao',
    objective: 'Resolução com título protestado. Suspensão da consultoria em andamento entra em vigor.',
    enabled: true,
    call: { enabled: true, attempts: ['phone'] },
    whatsapp: {
      enabled: true,
      variants: [
        '{{nome}}, o título de *{{valor}}* foi protestado e a consultoria em andamento está suspensa.\n\nAinda é possível negociar a regularização e a retirada do protesto. Responda esta mensagem para conversarmos sobre as condições.',
      ],
    },
    email: {
      enabled: true,
      subject: 'Negociação do título protestado — {{valor}}',
      body: 'Olá, {{nome}}.\n\nO título de {{valor}}, vencido em {{vencimento}}, foi protestado e a consultoria em andamento está suspensa. Ainda é possível negociar a regularização e a retirada do protesto.\n\nResponda este e-mail para conversarmos sobre as condições.',
      attachBoleto: false,
    },
    internal: { enabled: false, to: '', subject: '', body: '' },
  },
  {
    key: 'd+60',
    offset: 60,
    name: 'Encaminhamento jurídico',
    phase: 'recuperacao',
    objective: 'Formalização. Notificação extrajudicial, remoção da comunidade e dos últimos acessos.',
    enabled: true,
    call: { enabled: false, attempts: [] },
    whatsapp: {
      enabled: true,
      variants: [
        '{{nome}}, comunicamos que o débito de *{{valor}}*, vencido em {{vencimento}}, foi encaminhado ao nosso departamento jurídico para notificação extrajudicial.\n\nO acesso à comunidade e às plataformas foi encerrado. Para tratar do assunto, responda esta mensagem.',
      ],
    },
    email: { enabled: false, subject: '', body: '', attachBoleto: false },
    internal: {
      enabled: true,
      to: '',
      subject: 'Encaminhamento jurídico — {{nome}} — {{valor}}',
      body: 'Encaminhamos para notificação extrajudicial o título abaixo, em aberto há {{dias_atraso}} dias.\n\nCliente: {{nome}}\nTelefone: {{telefone}}\nE-mail: {{email}}\nTítulo: {{titulo}}\nValor: {{valor}}\nVencimento: {{vencimento}}\nBoleto: {{link_boleto}}\n\nAções pendentes: notificação extrajudicial, remoção da comunidade e dos últimos acessos.',
    },
  },
]

export const DEFAULT_DUNNING = {
  enabled: false,
  runAt: '09:00',
  days: ALL_DAYS,
  timeZone: DEFAULT_TIMEZONE,
  callCutoff: '17:00',
  catchupDays: 3,
  sending: {
    minDelay: 8,
    maxDelay: 20,
    typingSeconds: 3,
    window: { enabled: true, start: '08:00', end: '20:00', days: ALL_DAYS },
  },
  promise: {
    confirmEnabled: true,
    confirmTemplate:
      'Combinado, {{nome}}! Registramos o pagamento de *{{valor}}* para *{{data_promessa}}*.\n\nPara facilitar, segue o link: {{link_pagamento}} 🙏',
    brokenEnabled: true,
    brokenTemplate:
      'Olá, {{nome}}. Não identificamos o pagamento de *{{valor}}* combinado para {{data_promessa}}.\n\nAconteceu algum imprevisto? Pague pelo link {{link_pagamento}} ou responda esta mensagem para combinarmos uma nova data.',
  },
  stages: DEFAULT_STAGES,
}

export const CALL_ATTEMPTS = { phone: 'Ligação', whatsapp: 'Ligação pelo WhatsApp' }

export const CALL_RESULTS = {
  promise: 'Promessa de pagamento',
  no_deal: 'Atendeu, sem acordo',
  no_answer: 'Não atendeu',
  paid: 'Cliente já pagou',
  expired: 'Sem registro até o horário limite',
}

/** Variáveis disponíveis nos textos da régua. */
export const DUNNING_VARIABLES = [
  ['nome', 'Nome do cliente'],
  ['valor', 'Valor (R$)'],
  ['vencimento', 'Data de vencimento'],
  ['dias_atraso', 'Dias em atraso'],
  ['dias_para_vencer', 'Dias até o vencimento'],
  ['link_boleto', 'Link do boleto'],
  ['link_pagamento', 'Link de pagamento'],
  ['pix', 'Pix copia e cola'],
  ['titulo', 'Número do título'],
  ['data_protesto', 'Vencimento + 30 dias'],
  ['data_promessa', 'Data prometida'],
  ['telefone', 'Telefone'],
  ['email', 'E-mail'],
]

// ---- Datas (sempre "AAAA-MM-DD", no fuso da régua) ----------------------------------

const pad = (n) => String(n).padStart(2, '0')

export function todayKey(timeZone = DEFAULT_TIMEZONE, ts = Date.now()) {
  const p = zonedParts(ts, timeZone)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

export function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Diferença em dias de `from` até `to` (positivo = `to` depois de `from`). */
export function daysBetween(from, to) {
  const [a, b] = [from, to].map((k) => {
    const [y, m, d] = k.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  })
  return Math.round((b - a) / 86_400_000)
}

/** Aceita 25/10/2026, 25-10-26, 2026-10-25, 25.10.2026 e número de série do Excel. */
export function parseDateKey(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let y, m, d
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) [, y, m, d] = match.map(Number)
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    ;[, d, m, y] = match.map(Number)
    if (y < 100) y += 2000
  } else if (/^\d{5}$/.test(s)) {
    // Excel: dias desde 30/12/1899
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000)
    ;[y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]
  } else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export const formatDateBR = (key) => (key ? key.split('-').reverse().join('/') : '')

export const formatMoney = (n) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''

export const stageLabel = (offset) => (offset === 0 ? 'D0' : offset > 0 ? `D+${offset}` : `D${offset}`)

// ---- Títulos -------------------------------------------------------------------------

/** Campos de um título e como reconhecê-los pelo cabeçalho do CSV. */
export const TITLE_FIELDS = [
  { key: 'nome', label: 'Nome do cliente', required: true, match: /^(nome|cliente|razao social|sacado|pagador)/ },
  { key: 'telefone', label: 'Telefone / WhatsApp', required: true, match: /(telefone|celular|whats|fone|phone)/ },
  { key: 'vencimento', label: 'Vencimento', required: true, match: /venc/ },
  { key: 'valor', label: 'Valor', required: true, match: /(valor|montante|total)/ },
  { key: 'email', label: 'E-mail', match: /e ?mail/ },
  { key: 'numero', label: 'Número do título', match: /(numero|n titulo|titulo|nosso numero|documento|fatura|id)/ },
  { key: 'boleto', label: 'Link do boleto', match: /boleto|pdf/ },
  { key: 'pagamento', label: 'Link de pagamento', match: /(link|pagamento|checkout|url)/ },
  { key: 'pix', label: 'Pix copia e cola', match: /pix/ },
  { key: 'status', label: 'Status (pago / aberto)', match: /(status|situacao|pago)/ },
]

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()

/** Liga cada campo à coluna do CSV com nome mais parecido (cada coluna só uma vez). */
export function autoMapColumns(headers) {
  const used = new Set()
  const mapping = {}
  for (const field of TITLE_FIELDS) {
    const header = headers.find((h) => !used.has(h) && field.match.test(norm(h)))
    mapping[field.key] = header || ''
    if (header) used.add(header)
  }
  return mapping
}

export const isPaidStatus = (v) => /(pag|quit|liquid|baixad|paid|recebid)/i.test(norm(v))

/** Valores das variáveis para um título (colunas do CSV + campos calculados). */
export function titleVars(t, today) {
  const delay = today && t.vencimento ? daysBetween(t.vencimento, today) : 0
  return {
    ...(t.vars || {}),
    nome: t.nome || '',
    telefone: t.telefone || '',
    email: t.email || '',
    valor: formatMoney(t.valor),
    vencimento: formatDateBR(t.vencimento),
    dias_atraso: String(Math.max(0, delay)),
    dias_para_vencer: String(Math.max(0, -delay)),
    link_boleto: t.boleto || t.pagamento || '',
    link_pagamento: t.pagamento || t.boleto || '',
    pix: t.pix || '',
    titulo: t.numero || '',
    data_protesto: t.vencimento ? formatDateBR(addDays(t.vencimento, 30)) : '',
    data_promessa: t.promise?.date ? formatDateBR(t.promise.date) : '',
  }
}
