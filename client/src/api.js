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
  upload: (body) => request('/uploads', { method: 'POST', body }),
  testSend: (body) => request('/test-send', { method: 'POST', body }),
  campaigns: () => request('/campaigns'),
  campaign: (id) => request(`/campaigns/${id}`),
  contacts: (id, params) => request(`/campaigns/${id}/contacts?${new URLSearchParams(params)}`),
  createCampaign: (body) => request('/campaigns', { method: 'POST', body }),
  action: (id, action, body) => request(`/campaigns/${id}/${action}`, { method: 'POST', body }),
  remove: (id) => request(`/campaigns/${id}`, { method: 'DELETE' }),
  responses: () => request('/responses'),
  webhookTest: (body) => request('/webhook-test', { method: 'POST', body }),
  exportUrl: (id, only) => `/api/campaigns/${id}/export${only ? `?only=${only}` : ''}`,
}
