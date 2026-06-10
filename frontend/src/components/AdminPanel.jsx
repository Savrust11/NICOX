import { useCallback, useEffect, useState } from 'react'
import { Check, RefreshCw, UserCheck, X } from 'lucide-react'
import { api } from '../lib/api'
import './AdminPanel.css'

export default function AdminPanel() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // user id being processed
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await api.getPendingApprovals()
      setPending(data.pending || [])
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(id, decision) {
    setBusy(id)
    try {
      await api.approveUser(id, decision)
      setPending((prev) => prev.filter((u) => u.id !== id))
    } catch (e) {
      alert(`処理失敗: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  async function refreshHotspots() {
    try {
      const res = await fetch('/api/hotspots/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await (await import('../lib/api')).api && {}),
        },
        body: JSON.stringify({ days_back: 30, cluster_radius_meters: 100, min_points: 1 }),
      })
      const data = await res.json()
      alert(`ホットスポット再生成: ${data.hotspots_created ?? '?'} 件`)
    } catch (e) {
      alert(`失敗: ${e.message}`)
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-section">
        <div className="admin-section-header">
          <h2><UserCheck size={20} /> 承認待ち（{pending.length}件）</h2>
          <button className="admin-refresh" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> 更新
          </button>
        </div>

        {err && <p className="admin-error">{err}</p>}
        {!loading && pending.length === 0 && <p className="admin-empty">承認待ちのユーザーはいません。</p>}

        <ul className="admin-list">
          {pending.map((u) => (
            <li key={u.id} className="admin-row">
              <div className="admin-row-info">
                <div className="admin-row-name">{u.name}</div>
                <div className="admin-row-meta">
                  <span>{u.email}</span>
                  {u.organization && <span>所属: {u.organization}</span>}
                  <span>登録日: {new Date(u.created_at).toLocaleDateString('ja-JP')}</span>
                </div>
              </div>
              <div className="admin-row-actions">
                <button className="approve-btn" disabled={busy === u.id}
                  onClick={() => decide(u.id, 'approved')}>
                  <Check size={14} /> 承認
                </button>
                <button className="reject-btn" disabled={busy === u.id}
                  onClick={() => decide(u.id, 'rejected')}>
                  <X size={14} /> 却下
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
