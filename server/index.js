import { DATA_DIR, ON_RAILWAY, publicBaseUrl, ROOT } from './env.js'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import Papa from 'papaparse'
import { normalizePhone } from '../shared/phone.js'
import {
  clearFinanceConfig,
  dunningConnection,
  publicConfig,
  publicFinanceConfig,
  publicSmtp,
  setConfig,
  setFinanceConfig,
  setSmtp,
} from './config.js'
import { sendMail, verifySmtp } from './mailer.js'
import {
  dunningSends,
  dunningStats,
  exportRows,
  flushDunning,
  getDunningConfig,
  importTitles,
  listTasks,
  listTitles,
  resolveTask,
  retryFailedEmails,
  runDunning,
  saveDunningConfig,
  sendsAction,
  startDunning,
  titleAction,
  titleDetail,
} from './dunning.js'
import {
  cleanupUploads,
  completeUpload,
  createUpload,
  flushAll,
  getCampaign,
  listCampaigns,
  loadCampaigns,
  removeCampaign,
  UPLOAD_CHUNK_SIZE,
  uploadFilePath,
  uploadInfo,
  writeUploadChunk,
} from './store.js'
import { instanceStatus, serverVersion, UazapiError, versionAtLeast } from './uazapi.js'
import {
  ADMIN_USER,
  authEnabled,
  checkCredentials,
  clearFailures,
  currentUser,
  endSession,
  loginBlockedFor,
  registerFailure,
  requireAuth,
  startSession,
} from './auth.js'
import { listenerStatus, restartListener, startListener, webhookHandler } from './events.js'
import {
  createTestSession,
  FLOW_FILTERS,
  normalizeFlow,
  normalizeWebhook,
  postJson,
  recentEvents,
  resumePendingWebhooks,
  retryFailedWebhooks,
} from './flow.js'
import {
  buildWebhookPayload,
  createWorkflowTestSession,
  onInitialSent,
  resumeWorkflowWebhooks,
  retryWorkflowWebhooks,
  startWorkflowTimers,
  workflowFilter,
} from './workflow.js'
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  getWorkflow,
  listWorkflows,
  loadWorkflows,
  snapshotForCampaign,
  updateWorkflow,
  workflowSummary,
} from './workflows.js'
import { cleanWorkflow, nodeById, savedVariables } from '../shared/workflow.js'
import { buildLeadPayload, DEFAULT_DATA_STEP } from '../shared/datafields.js'
import { DEFAULT_TIMEZONE } from '../shared/schedule.js'
import {
  cancelCampaign,
  createCampaign,
  INLINE_MAX_BYTES,
  MEDIA_LIMITS,
  deliver,
  kick,
  normalizeMedia,
  normalizeSettings,
  pauseCampaign,
  resumeCampaign,
  reschedule,
  retryFailed,
  shutdownRunner,
  startNow,
  startScheduler,
  summarize,
  ValidationError,
} from './campaigns.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.disable('x-powered-by')
// Atrás do proxy do Railway: usa o IP real e reconhece HTTPS (cookie Secure)
if (ON_RAILWAY || process.env.TRUST_PROXY) app.set('trust proxy', 1)
app.use(express.json({ limit: '64mb' }))

// Healthcheck (Railway): fora da senha do painel
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }))

// Webhook da uazapi (opcional): autenticado pelo token da instância no payload, fora da senha do painel
app.post('/api/webhook/uazapi', webhookHandler)

// Mídias dos disparos: a uazapi baixa daqui. Público, mas o id é um UUID aleatório (impossível de adivinhar).
app.get('/media/:id/:name', (req, res) => {
  const info = uploadInfo(req.params.id)
  if (!info?.complete) return res.status(404).send('Arquivo não encontrado')
  res.set('Cache-Control', 'private, max-age=3600')
  if (info.kind === 'b64') {
    const buffer = Buffer.from(fs.readFileSync(path.join(path.dirname(uploadFilePath(req.params.id)), `${req.params.id}.b64`), 'utf8'), 'base64')
    return res.type(info.mimetype || 'application/octet-stream').send(buffer)
  }
  // sendFile atende "Range" (download em partes / retomada)
  res.sendFile(uploadFilePath(req.params.id), { headers: { 'Content-Type': info.mimetype || 'application/octet-stream' } })
})

// ---- Login (usuário admin + ADMIN_PASSWORD do .env) ---------------------------------------

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req)
  res.json({ authEnabled, authenticated: !authEnabled || Boolean(user), user: authEnabled ? user : null })
})

app.post('/api/auth/login', (req, res) => {
  if (!authEnabled) return res.json({ ok: true, user: null })
  const ip = req.ip
  const wait = loginBlockedFor(ip)
  if (wait) {
    res.set('Retry-After', String(wait))
    return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${Math.ceil(wait / 60)} min.` })
  }
  const { username, password, remember } = req.body || {}
  if (!checkCredentials(username, password)) {
    registerFailure(ip)
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' })
  }
  clearFailures(ip)
  startSession(req, res, ADMIN_USER, Boolean(remember))
  res.json({ ok: true, user: ADMIN_USER })
})

app.post('/api/auth/logout', (req, res) => {
  endSession(req, res)
  res.json({ ok: true })
})

// Todo o restante da API exige login (o frontend estático é público: só tem a tela de login)
app.use('/api', requireAuth)

const api = express.Router()

function findCampaign(req) {
  const c = getCampaign(req.params.id)
  if (!c) throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 })
  return c
}

// ---- Configuração / instância --------------------------------------------------

api.get('/config', (req, res) => res.json(publicConfig()))

api.put('/config', (req, res) => {
  try {
    setConfig(req.body || {})
  } catch (err) {
    throw new ValidationError(err.message)
  }
  restartListener()
  res.json(publicConfig())
})

/** Capacidades do servidor: versão da uazapi e como as mídias são entregues. */
async function serverInfo() {
  const version = await serverVersion()
  return {
    version,
    buttonMedia: versionAtLeast(version, '2.6.0'),
    publicMedia: Boolean(publicBaseUrl()),
    inlineLimitMB: Math.round(INLINE_MAX_BYTES / 1024 / 1024),
    limitsMB: Object.fromEntries(Object.entries(MEDIA_LIMITS).map(([k, v]) => [k, Math.round(v / 1024 / 1024)])),
  }
}

api.get('/instance', async (req, res) => {
  const cfg = publicConfig()
  if (!cfg.baseUrl || !cfg.hasToken) return res.json({ configured: false, server: await serverInfo() })
  const server = await serverInfo()
  try {
    const data = await instanceStatus()
    const inst = data?.instance || {}
    res.json({
      server,
      configured: true,
      state: inst.status || (data?.status?.connected ? 'connected' : 'disconnected'),
      connected: Boolean(data?.status?.connected && data?.status?.loggedIn !== false),
      name: inst.name || '',
      profileName: inst.profileName || '',
      number: data?.status?.jid?.user || '',
    })
  } catch (err) {
    res.json({ configured: true, state: 'error', connected: false, error: err.message, server })
  }
})

// ---- Mídia e envio de teste ------------------------------------------------------

// Upload em partes: init → PUT de cada parte (8 MB) → complete. Suporta vídeos de até 512 MB.
api.post('/uploads/init', (req, res) => {
  const { fileName, mimetype, size, type } = req.body || {}
  const bytes = Number(size)
  if (!Number.isInteger(bytes) || bytes <= 0) throw new ValidationError('Arquivo vazio.')
  const limit = MEDIA_LIMITS[type] || MEDIA_LIMITS.document
  if (bytes > limit) throw new ValidationError(`Arquivo grande demais: o limite para este tipo é ${Math.round(limit / 1024 / 1024)} MB.`)
  if (!publicBaseUrl() && bytes > INLINE_MAX_BYTES) {
    throw new ValidationError(
      `Arquivos acima de ${Math.round(INLINE_MAX_BYTES / 1024 / 1024)} MB precisam que o painel tenha um endereço público (Railway ou PUBLIC_URL), para a uazapi baixar o arquivo.`,
    )
  }
  const upload = createUpload({
    fileName: String(fileName || 'arquivo').slice(0, 200),
    mimetype: String(mimetype || '').slice(0, 100),
    size: bytes,
  })
  res.status(201).json(upload)
})

api.put(
  '/uploads/:id/chunks/:index',
  express.raw({ type: () => true, limit: UPLOAD_CHUNK_SIZE + 1024 * 1024 }),
  async (req, res) => {
    try {
      await writeUploadChunk(req.params.id, Number(req.params.index), req.body)
    } catch (err) {
      throw new ValidationError(err.message)
    }
    res.json({ ok: true })
  },
)

api.post('/uploads/:id/complete', (req, res) => {
  try {
    res.json(completeUpload(req.params.id))
  } catch (err) {
    throw new ValidationError(err.message)
  }
})

api.post('/test-send', async (req, res) => {
  const { number, template = '', vars = {}, media, settings, countryCode = '55', flow: flowInput, workflowId } = req.body || {}
  const normalized = normalizePhone(number, countryCode)
  if (!normalized) throw new ValidationError('Número de teste inválido.')
  const normalizedMedia = normalizeMedia(media)
  const workflow = workflowId ? snapshotForCampaign(workflowId, 'teste') : null
  const flow = workflow ? null : normalizeFlow(flowInput)
  const withButtons = Boolean(flow) || Boolean(workflow?.nodes.find((n) => n.type === 'start')?.data.choices.length)
  if (withButtons && !String(template).trim()) throw new ValidationError('Escreva o texto da mensagem com botões.')
  if (!String(template).trim() && !normalizedMedia) throw new ValidationError('Escreva a mensagem ou anexe uma mídia.')

  // O teste vira uma sessão temporária para o fluxo/workflow responder no seu número
  const session = flow ? createTestSession({ flow, vars, number: normalized }) : null
  const wfSession = workflow ? createWorkflowTestSession({ workflow, vars, number: normalized }) : null
  if (session || wfSession) startListener()

  try {
    const result = await deliver({
      number: normalized,
      template,
      vars,
      media: normalizedMedia,
      settings: { ...normalizeSettings(settings), typingSeconds: 0 },
      flow,
      workflow,
      flowKey: session?.key || wfSession?.key,
    })
    if (session) session.contacts[0].messageId = result.messageId
    if (wfSession) {
      wfSession.contacts[0].messageId = result.messageId
      onInitialSent(wfSession, wfSession.contacts[0])
    }
    res.json({ ok: true, number: normalized, flow: Boolean(flow || workflow), ...result })
  } catch (err) {
    if (err instanceof UazapiError) throw Object.assign(new Error(err.message), { status: 502 })
    throw err
  }
})

// ---- Campanhas -------------------------------------------------------------------

// A campanha interna da régua de cobrança é acompanhada só pela aba Cobrança
api.get('/campaigns', (req, res) => res.json(listCampaigns().filter((c) => !c.source).map(summarize)))

api.post('/campaigns', (req, res) => {
  const c = createCampaign(req.body || {})
  if (c.flow || c.workflow) startListener()
  res.status(201).json(summarize(c))
})

api.get('/responses', (req, res) => res.json({ ...listenerStatus(), recent: recentEvents() }))

// Envia um lead de exemplo ao webhook (para mapear os campos no CRM antes do disparo)
api.post('/webhook-test', async (req, res) => {
  const { webhook: input, dataFields, vars = {} } = req.body || {}
  const webhook = normalizeWebhook(input)
  if (!webhook) throw new ValidationError('Informe a URL do webhook.')
  const list = Array.isArray(dataFields) && dataFields.length ? dataFields : DEFAULT_DATA_STEP.fields
  const samples = { email: 'teste@exemplo.com.br', phone: '(11) 99999-8888', text: 'Teste' }
  const values = list.map((f) => (/^nome/i.test(f.label || '') ? 'Lead de Teste' : samples[f.type] || 'Teste'))
  const payload = buildLeadPayload({
    webhook,
    fields: list,
    values,
    vars,
    number: '5511999998888',
    revenue: 'Acima de R$ 80 mil',
    campaign: 'Teste de webhook',
    test: true,
  })
  const result = await postJson(webhook.url, payload)
  res.json({ ...result, payload })
})

// ---- Workflows (templates) --------------------------------------------------------

api.get('/workflows', (req, res) => res.json(listWorkflows().map(workflowSummary)))
api.get('/workflows/:id', (req, res) => {
  const wf = getWorkflow(req.params.id)
  res.json({ ...wf, ...workflowSummary(wf) })
})
api.post('/workflows', (req, res) => {
  const wf = createWorkflow(req.body || {})
  res.status(201).json({ ...wf, ...workflowSummary(wf) })
})
api.put('/workflows/:id', (req, res) => {
  const wf = updateWorkflow(req.params.id, req.body || {})
  res.json({ ...wf, ...workflowSummary(wf) })
})
api.post('/workflows/:id/duplicate', (req, res) => {
  const wf = duplicateWorkflow(req.params.id)
  res.status(201).json({ ...wf, ...workflowSummary(wf) })
})
api.delete('/workflows/:id', (req, res) => {
  deleteWorkflow(req.params.id)
  res.status(204).end()
})

// Envia um exemplo do bloco "Webhook" (para mapear os campos no CRM antes do disparo)
api.post('/workflows/webhook-test', async (req, res) => {
  const { workflow: input, nodeId, vars = {} } = req.body || {}
  const wf = cleanWorkflow(input)
  const node = nodeById(wf, nodeId)
  if (!node || node.type !== 'webhook') throw new ValidationError('Bloco de webhook não encontrado.')
  if (!/^https?:\/\/[^\s/]+/i.test(node.data.url)) throw new ValidationError('Informe a URL do webhook.')
  const samples = {}
  for (const v of savedVariables(wf)) samples[v.name] = /mail/i.test(v.name) ? 'teste@exemplo.com.br' : /telefone|phone|celular/i.test(v.name) ? '5511999998888' : `[${v.name}]`
  const sample = { ...samples, ...vars, whatsapp: '5511999998888', campanha: 'Teste de webhook' }
  const payload = buildWebhookPayload(node.data, sample, vars, true)
  const result = await postJson(node.data.url, payload)
  res.json({ ...result, payload })
})

api.get('/campaigns/:id', (req, res) => {
  const c = findCampaign(req)
  res.json({ ...summarize(c), log: c.log.slice(-100).reverse() })
})

api.get('/campaigns/:id/contacts', (req, res) => {
  const c = findCampaign(req)
  const status = String(req.query.status || '')
  const flowFilter = c.workflow ? null : FLOW_FILTERS[String(req.query.flow || '')]
  const wfFilter = c.workflow ? workflowFilter(req.query.flow) : null
  const q = String(req.query.q || '').trim().toLowerCase()
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50))
  const page = Math.max(1, Number(req.query.page) || 1)

  let items = c.contacts
  if (status) items = items.filter((ct) => ct.status === status)
  if (flowFilter) items = items.filter((ct) => ct.status === 'sent' && flowFilter(ct.flow || {}))
  if (wfFilter) items = items.filter((ct) => ct.status === 'sent' && ct.wf && wfFilter(ct.wf))
  if (q) {
    items = items.filter(
      (ct) =>
        (ct.number || ct.raw).toLowerCase().includes(q) ||
        Object.values(ct.vars || {}).some((v) => String(v).toLowerCase().includes(q)),
    )
  }

  res.json({
    total: items.length,
    page,
    pageSize,
    items: items.slice((page - 1) * pageSize, page * pageSize).map((ct) => ({
      i: ct.i,
      number: ct.number || ct.raw,
      vars: ct.vars,
      status: ct.status,
      error: ct.error,
      text: ct.text,
      messageId: ct.messageId,
      processedAt: ct.processedAt,
      flow: ct.flow || null,
      wf: ct.wf ? wfView(ct.wf) : null,
    })),
  })
})

api.get('/campaigns/:id/export', (req, res) => {
  const c = findCampaign(req)
  const labels = { pending: 'pendente', sent: 'enviado', failed: 'falha', invalid: 'inválido', skipped: 'ignorado' }
  // O servidor pode rodar em UTC (Railway): usa o fuso de quem criou a campanha
  const timeZone = c.settings.timeZone || c.settings.window?.timeZone || DEFAULT_TIMEZONE
  const when = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { timeZone }) : '')
  if (c.workflow) return exportWorkflowCampaign(c, req, res, when, labels)
  const onlyFilter = c.flow ? FLOW_FILTERS[String(req.query.only || '')] : null

  const fields = [...c.headers, 'numero_whatsapp', 'status', 'erro', 'mensagem_enviada', 'message_id', 'processado_em']
  const dataFields = c.flow?.dataStep?.fields || []
  if (c.flow) fields.push('resposta_interesse', 'faixa_faturamento', 'qualificado', 'ultima_resposta', 'respondido_em')
  if (dataFields.length) fields.push('dados_confirmados', 'dados_alterados', ...dataFields.map((f) => `confirmado_${f.label}`))
  if (c.flow?.webhook) fields.push('webhook_status', 'webhook_erro')

  let contacts = c.contacts
  if (onlyFilter) contacts = contacts.filter((ct) => ct.status === 'sent' && onlyFilter(ct.flow || {}))

  const data = contacts.map((ct) => {
    const row = [
      ...c.headers.map((h) => ct.vars?.[h] ?? ''),
      ct.number || '',
      labels[ct.status] || ct.status,
      ct.error || '',
      ct.text || '',
      ct.messageId || '',
      when(ct.processedAt),
    ]
    if (c.flow) {
      const f = ct.flow || {}
      row.push(
        f.interest === 'yes' ? 'sim' : f.interest === 'no' ? 'não' : '',
        f.revenueLabel || '',
        f.revenueIndex == null ? '' : f.qualified ? 'sim' : 'não',
        f.lastReply || '',
        when(f.revenueAt || f.interestAt),
      )
      if (dataFields.length) {
        row.push(
          f.dataConfirmed ? 'sim' : f.dataStarted ? 'não' : '',
          f.dataConfirmed ? (f.dataChanged ? 'sim' : 'não') : '',
          ...dataFields.map((_, i) => (f.dataConfirmed ? f.data?.[i] || '' : '')),
        )
      }
      if (c.flow.webhook) {
        const wh = { sent: 'enviado', failed: 'falha', pending: 'enviando' }
        row.push(wh[f.webhook?.status] || '', f.webhook?.status === 'failed' ? f.webhook.error || '' : '')
      }
    }
    return row
  })
  const csv = Papa.unparse({ fields, data }, { delimiter: ';' })
  const suffix = onlyFilter ? `-${req.query.only}` : ''
  const fileName = `${c.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'campanha'}${suffix}.csv`
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  res.send('﻿' + csv) // BOM para o Excel reconhecer UTF-8
})

/** O estado do contato no workflow, como a tabela mostra. */
function wfView(s) {
  return {
    node: s.node,
    since: s.since,
    timeoutAt: s.timeoutAt,
    tags: s.tags || [],
    answers: s.answers || {},
    vars: s.vars || {},
    done: Boolean(s.done),
    lastReply: s.lastReply || null,
    lastReplyAt: s.lastReplyAt || null,
    webhooks: s.webhooks || {},
  }
}

/** Export de campanha com workflow: respostas guardadas, etiquetas, etapa atual e webhooks. */
function exportWorkflowCampaign(c, req, res, when, labels) {
  const filter = workflowFilter(req.query.only)
  const vars = savedVariables(c.workflow).map((v) => v.name)
  const webhookNodes = c.workflow.nodes.filter((n) => n.type === 'webhook')
  const titleOf = (n) => n?.data.title || n?.type || ''
  const fields = [
    ...c.headers,
    'numero_whatsapp',
    'status',
    'erro',
    'mensagem_enviada',
    'message_id',
    'processado_em',
    'etapa_atual',
    'concluido',
    'etiquetas',
    'ultima_resposta',
    'respondido_em',
    ...vars.map((v) => `resposta_${v}`),
    ...webhookNodes.flatMap((n) => [`webhook_${titleOf(n)}_status`, `webhook_${titleOf(n)}_erro`]),
  ]
  let contacts = c.contacts
  if (filter) contacts = contacts.filter((ct) => ct.status === 'sent' && ct.wf && filter(ct.wf))
  const whLabels = { sent: 'enviado', failed: 'falha', pending: 'enviando' }
  const data = contacts.map((ct) => {
    const s = ct.wf || {}
    return [
      ...c.headers.map((h) => ct.vars?.[h] ?? ''),
      ct.number || '',
      labels[ct.status] || ct.status,
      ct.error || '',
      ct.text || '',
      ct.messageId || '',
      when(ct.processedAt),
      s.node ? titleOf(nodeById(c.workflow, s.node)) : '',
      s.done ? 'sim' : ct.wf ? 'não' : '',
      (s.tags || []).join(', '),
      s.lastReply || '',
      when(s.lastReplyAt),
      ...vars.map((v) => s.vars?.[v] ?? ''),
      ...webhookNodes.flatMap((n) => {
        const w = s.webhooks?.[n.id]
        return [whLabels[w?.status] || '', w?.status === 'failed' ? w.error || '' : '']
      }),
    ]
  })
  const csv = Papa.unparse({ fields, data }, { delimiter: ';' })
  const suffix = req.query.only ? `-${String(req.query.only).replace(/[^\p{L}\p{N}_-]+/gu, '_')}` : ''
  const fileName = `${c.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'campanha'}${suffix}.csv`
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  res.send('\uFEFF' + csv)
}

const actions = {
  pause: pauseCampaign,
  resume: resumeCampaign,
  cancel: cancelCampaign,
  'retry-failed': retryFailed,
  'start-now': startNow,
  'retry-webhooks': (c) => (c.workflow ? retryWorkflowWebhooks(c) : retryFailedWebhooks(c)),
  reschedule: (c, body) => reschedule(c, body?.startAt),
}

api.post('/campaigns/:id/:action', (req, res) => {
  const fn = actions[req.params.action]
  if (!fn) throw Object.assign(new Error('Ação desconhecida.'), { status: 404 })
  const c = findCampaign(req)
  fn(c, req.body)
  res.json(summarize(c))
})

api.delete('/campaigns/:id', (req, res) => {
  const c = findCampaign(req)
  if (c.status === 'running' || c.status === 'queued') throw new ValidationError('Pause ou cancele a campanha antes de excluir.')
  removeCampaign(c.id)
  res.status(204).end()
})

// ---- SMTP (e-mails da régua) ---------------------------------------------------------------

api.get('/smtp', (req, res) => res.json(publicSmtp()))

api.put('/smtp', (req, res) => {
  try {
    setSmtp(req.body || {})
  } catch (err) {
    throw new ValidationError(err.message)
  }
  res.json(publicSmtp())
})

api.post('/smtp/test', async (req, res) => {
  const to = String(req.body?.to || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ValidationError('Informe um e-mail válido para o teste.')
  try {
    await verifySmtp()
    await sendMail({ to, subject: 'Teste da régua de cobrança', text: 'Se você recebeu este e-mail, o SMTP do painel de disparos está funcionando. ✅' })
  } catch (err) {
    throw new ValidationError(`Falha no SMTP: ${err.message}`)
  }
  res.json({ ok: true })
})

// ---- Régua de cobrança ----------------------------------------------------------------------

api.get('/regua', (req, res) => res.json({ config: getDunningConfig(), stats: dunningStats(), smtp: publicSmtp() }))

api.put('/regua/config', (req, res) => res.json(saveDunningConfig(req.body || {})))

api.post('/regua/executar', (req, res) => res.json(runDunning({ manual: true })))

api.post('/regua/reenviar-emails', (req, res) => res.json({ count: retryFailedEmails() }))

api.get('/regua/titulos', (req, res) => res.json(listTitles(req.query)))

api.post('/regua/titulos/importar', (req, res) => res.json(importTitles(req.body || {})))

api.get('/regua/titulos/:id', (req, res) => res.json(titleDetail(req.params.id)))

api.post('/regua/titulos/:id/:action', (req, res) => res.json(titleAction(req.params.id, req.params.action, req.body || {})))

api.get('/regua/tarefas', (req, res) => res.json(listTasks({ status: String(req.query.status || 'open') })))

api.post('/regua/tarefas/:id', (req, res) => res.json(resolveTask(req.params.id, req.body || {})))

// Envios do dia (WhatsApp + e-mails) e controles
api.get('/regua/envios', (req, res) => res.json(dunningSends(req.query)))

api.post('/regua/envios/:action', (req, res) => res.json(sendsAction(req.params.action, req.body?.date)))

// Instância uazapi do financeiro (separada da das campanhas)
async function financeInstance() {
  const conn = dunningConnection()
  const info = { ...publicFinanceConfig(), using: conn.kind }
  if (!conn.baseUrl || !conn.token) return { ...info, state: 'unconfigured', connected: false }
  try {
    const data = await instanceStatus(conn)
    const inst = data?.instance || {}
    return {
      ...info,
      state: inst.status || (data?.status?.connected ? 'connected' : 'disconnected'),
      connected: Boolean(data?.status?.connected && data?.status?.loggedIn !== false),
      profileName: inst.profileName || '',
      number: data?.status?.jid?.user || '',
    }
  } catch (err) {
    return { ...info, state: 'error', connected: false, error: err.message }
  }
}

api.get('/regua/instancia', async (req, res) => res.json(await financeInstance()))

api.put('/regua/instancia', async (req, res) => {
  try {
    setFinanceConfig(req.body || {})
  } catch (err) {
    throw new ValidationError(err.message)
  }
  kick()
  res.json(await financeInstance())
})

api.delete('/regua/instancia', async (req, res) => {
  clearFinanceConfig()
  kick()
  res.json(await financeInstance())
})

api.get('/regua/exportar', (req, res) => {
  const rows = exportRows()
  const csv = Papa.unparse(rows.length ? rows : [{ nome: '' }], { delimiter: ';' })
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="regua-de-cobranca-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send('\uFEFF' + csv)
})

api.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }))

app.use('/api', api)

// ---- Frontend (build do Vite) -------------------------------------------------------

const dist = path.join(ROOT, 'dist')
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist))
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()))
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof ValidationError ? 400 : err.status || err.statusCode || 500
  if (status >= 500 && status !== 502) console.error(err)
  const message = err.type === 'entity.too.large' ? 'Arquivo muito grande (limite de 64 MB).' : err.message
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor.' : message })
})

// ---- Inicialização -------------------------------------------------------------------

const loaded = loadCampaigns()
loadWorkflows()
app.listen(PORT, () => {
  console.log(`API de disparos na porta ${PORT} (${loaded} campanhas carregadas, dados em ${DATA_DIR})`)
  if (ON_RAILWAY && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) {
    console.warn('⚠ Nenhum volume anexado: campanhas e configurações serão perdidas a cada deploy. Veja o DEPLOY.md.')
  }
  if (!authEnabled) {
    console.warn('⚠ ADMIN_PASSWORD não definida no .env: o painel está SEM login e qualquer pessoa com o endereço pode disparar.')
  } else {
    console.log(`Login ativo para o usuário "${ADMIN_USER}".`)
  }
  kick()
  startScheduler()
  startListener()
  resumePendingWebhooks()
  startDunning()
  resumeWorkflowWebhooks()
  startWorkflowTimers()
  scheduleUploadCleanup()
  checkPublicUrl()
})

/** Apaga, a cada 6 h, uploads com mais de 24 h que nenhuma campanha usa. */
function scheduleUploadCleanup() {
  const run = () => {
    const used = new Set(listCampaigns().map((c) => c.media?.uploadId).filter(Boolean))
    const removed = cleanupUploads(used)
    if (removed) console.log(`Limpeza: ${removed} arquivo(s) de mídia sem uso removido(s).`)
  }
  run()
  setInterval(run, 6 * 3600_000).unref()
}

/** Avisa no log se o endereço público não responde (a uazapi não conseguiria baixar as mídias). */
async function checkPublicUrl() {
  const base = publicBaseUrl()
  if (!base) {
    console.log(`Sem endereço público (PUBLIC_URL): mídias vão em base64, até ${Math.round(INLINE_MAX_BYTES / 1024 / 1024)} MB.`)
    return
  }
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) })
    console.log(res.ok ? `Mídias servidas em ${base}/media/…` : `⚠ ${base} respondeu HTTP ${res.status}: a uazapi pode não conseguir baixar as mídias.`)
  } catch (err) {
    console.warn(`⚠ Não foi possível acessar ${base} (${err.cause?.code || err.message}): a uazapi pode não conseguir baixar as mídias.`)
  }
}

// Desligamento gracioso: termina o envio em andamento e salva tudo antes de sair
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    console.log(`${signal} recebido: finalizando o envio em andamento e salvando…`)
    await shutdownRunner()
    flushAll()
    flushDunning()
    process.exit(0)
  })
}
