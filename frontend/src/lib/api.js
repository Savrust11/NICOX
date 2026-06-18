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

  // ====== Admin ======
  adminDashboard: () => request('/api/admin/dashboard'),

  adminListUsers: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/admin/users${qs ? '?' + qs : ''}`)
  },
  adminUpdateUser: (id, patch) =>
    request(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  adminDeleteUser: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),

  adminListReports: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/admin/reports${qs ? '?' + qs : ''}`)
  },
  adminGetReport: (id) => request(`/api/admin/reports/${id}`),
  adminUpdateReport: (id, patch) =>
    request(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  adminDeleteReport: (id) => request(`/api/admin/reports/${id}`, { method: 'DELETE' }),
  adminBulkDeleteReports: (ids) =>
    request('/api/admin/reports/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),

  adminListHotspots: () => request('/api/admin/hotspots'),
  adminDeleteHotspot: (id) => request(`/api/admin/hotspots/${id}`, { method: 'DELETE' }),
  adminRefreshHotspots: (cfg) =>
    request('/api/admin/hotspots/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    }),

  adminListAreas: () => request('/api/admin/areas'),
  adminCreateArea: (data) =>
    request('/api/admin/areas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  adminUpdateArea: (id, patch) =>
    request(`/api/admin/areas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  adminDeleteArea: (id) => request(`/api/admin/areas/${id}`, { method: 'DELETE' }),

  adminAuditLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/admin/audit-log${qs ? '?' + qs : ''}`)
  },

  adminExportReportsCsvUrl: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return `${BASE}/api/admin/export/reports.csv${qs ? '?' + qs : ''}`
  },
  adminExportReportsCsv: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`${BASE}/api/admin/export/reports.csv${qs ? '?' + qs : ''}`, {
      headers: await authHeader(),
    })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    return res.blob()
  },
}
