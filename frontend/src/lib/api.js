const BASE = import.meta.env.VITE_API_BASE_URL || ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...options })
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
}
