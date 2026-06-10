import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

async function authHeader() {
  if (!supabase) return {}
  const { data } = await supabase.auth.getSession()
  if (!data?.session) return {}
  return { Authorization: `Bearer ${data.session.access_token}` }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}), ...(await authHeader()) }
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...options, headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${options.method || 'GET'} ${path} → ${res.status}: ${body}`)
  }
  return res.json()
}

export const api = {
  submitReport: (data) =>
    request('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  uploadMedia: (reportId, file) => {
    const form = new FormData()
    form.append('image', file)
    return request(`/api/reports/${reportId}/media`, { method: 'POST', body: form })
  },

  getReports: (params = {}) => {
    const qs = new URLSearchParams({ limit: 200, ...params }).toString()
    return request(`/api/reports?${qs}`)
  },

  getHotspots: () => request('/api/hotspots'),

  getHotspot: (id) => request(`/api/hotspots/${id}`),

  getPublicStats: () => request('/api/stats/public'),

  getPendingApprovals: () => request('/api/auth/pending'),

  approveUser: (id, decision) =>
    request(`/api/auth/users/${id}/approval`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }),
}
