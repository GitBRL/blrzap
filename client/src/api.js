async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  // Sessão expirada: avisa o App para mostrar a tela de login
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'))
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data
}

export const api = {
  me: () => request('/auth/me'),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  config: () => request('/config'),
  saveConfig: (body) => request('/config', { method: 'PUT', body }),
  instance: () => request('/instance'),
  uploadInit: (body) => request('/uploads/init', { method: 'POST', body }),
  uploadComplete: (id) => request(`/uploads/${id}/complete`, { method: 'POST' }),
  /** Envia uma parte binária do arquivo (sem converter para base64). */
  uploadChunk: async (id, index, blob) => {
    const res = await fetch(`/api/uploads/${id}/chunks/${index}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
    })
    if (res.status === 401) window.dispatchEvent(new Event('auth:expired'))
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status} no envio do arquivo`)
  },
  testSend: (body) => request('/test-send', { method: 'POST', body }),
  campaigns: () => request('/campaigns'),
  campaign: (id) => request(`/campaigns/${id}`),
  contacts: (id, params) => request(`/campaigns/${id}/contacts?${new URLSearchParams(params)}`),
  createCampaign: (body) => request('/campaigns', { method: 'POST', body }),
  action: (id, action, body) => request(`/campaigns/${id}/${action}`, { method: 'POST', body }),
  remove: (id) => request(`/campaigns/${id}`, { method: 'DELETE' }),
  responses: () => request('/responses'),
  // Régua de cobrança
  regua: () => request('/regua'),
  saveRegua: (body) => request('/regua/config', { method: 'PUT', body }),
  runRegua: () => request('/regua/executar', { method: 'POST' }),
  retryReguaEmails: () => request('/regua/reenviar-emails', { method: 'POST' }),
  titulos: (params) => request(`/regua/titulos?${new URLSearchParams(params)}`),
  importTitulos: (body) => request('/regua/titulos/importar', { method: 'POST', body }),
  titulo: (id) => request(`/regua/titulos/${id}`),
  tituloAction: (id, action, body = {}) => request(`/regua/titulos/${id}/${action}`, { method: 'POST', body }),
  tarefas: (status = 'open') => request(`/regua/tarefas?status=${status}`),
  resolveTarefa: (id, body) => request(`/regua/tarefas/${id}`, { method: 'POST', body }),
  reguaExportUrl: () => '/api/regua/exportar',
  envios: (params) => request(`/regua/envios?${new URLSearchParams(params)}`),
  enviosAction: (action, date) => request(`/regua/envios/${action}`, { method: 'POST', body: { date } }),
  instanciaFinanceiro: () => request('/regua/instancia'),
  saveInstanciaFinanceiro: (body) => request('/regua/instancia', { method: 'PUT', body }),
  removeInstanciaFinanceiro: () => request('/regua/instancia', { method: 'DELETE' }),
  smtp: () => request('/smtp'),
  saveSmtp: (body) => request('/smtp', { method: 'PUT', body }),
  testSmtp: (to) => request('/smtp/test', { method: 'POST', body: { to } }),
  webhookTest: (body) => request('/webhook-test', { method: 'POST', body }),
  exportUrl: (id, only) => `/api/campaigns/${id}/export${only ? `?only=${encodeURIComponent(only)}` : ''}`,
  workflows: () => request('/workflows'),
  workflow: (id) => request(`/workflows/${id}`),
  createWorkflow: (body) => request('/workflows', { method: 'POST', body }),
  saveWorkflow: (id, body) => request(`/workflows/${id}`, { method: 'PUT', body }),
  duplicateWorkflow: (id) => request(`/workflows/${id}/duplicate`, { method: 'POST' }),
  removeWorkflow: (id) => request(`/workflows/${id}`, { method: 'DELETE' }),
  workflowWebhookTest: (body) => request('/workflows/webhook-test', { method: 'POST', body }),
}
