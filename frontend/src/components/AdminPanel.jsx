import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3, Users, FileText, MapPin, Map as MapIcon, ClipboardList, Download,
  Check, X, RefreshCw, Trash2, Search, Eye,
} from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// NOTE: area assignment for members is managed via the AreaAssignModal below
import { api } from '../lib/api'
import './AdminPanel.css'

// ---- Japanese display labels (DB values stay English) ----
const LABEL = {
  role: { admin: '管理者', member: '活動者', citizen: '市民' },
  approval: { approved: '承認済み', pending_approval: '承認待ち', rejected: '却下' },
  reportStatus: { pending: '未対応', processed: '対応済み', discarded: '破棄' },
  hotspotStatus: { active: '活動中', monitoring: '監視中', high_priority: '高優先', resolved: '解決済み' },
  areaType: { district: '地区', ward: '区', city: '市', custom: 'カスタム' },
  catCount: { '1-3': '1〜3', '4-10': '4〜10', '10+': '10以上', unknown: '不明' },
  earCut: { all: '全てあり', some: '一部あり', none: 'なし', unknown: '不明' },
  kittenStatus: { present: 'いる', absent: 'いない', unknown: '不明' },
  problem: {
    waste_damage: '糞尿被害',
    noise_damage: '鳴き声被害',
    cats_increasing: '猫が増えている',
    hoarding_site: '多頭飼育現場がある',
    feeding_issue: '餌やりトラブル',
    // legacy short codes
    waste: '糞尿',
    kittens: '子猫',
    noise: '鳴き声',
    unfixed: '未手術猫',
    feeding: '餌やり問題',
  },
  request: {
    reduce_damage: '被害を減らしたい',
    reduce_cats: '猫を減らしたい',
    want_surgery: '手術をしたい',
    consult: '相談したい',
    volunteer: '活動に協力したい',
    // legacy
    immediate: 'すぐ対応してほしい',
  },
}
const trList = (map, arr) => (arr || []).map((v) => tr(map, v)).join(', ') || '-'
const fmtCoord = (lat, lng) => {
  if (lat == null || lng == null) return '-'
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lng).toFixed(4)}°${ew}`
}
const tr = (map, v) => map[v] ?? v

const FIELD_LABEL = {
  status: 'ステータス',
  role: '役割',
  approval_status: '承認状態',
  is_active: '有効',
  area_type: '種別',
  area_ids: 'エリアID',
  ids: '対象ID',
  notes: 'メモ',
  name: '名前',
  email: 'メール',
  description: '説明',
  organization: '所属',
  phone: '電話',
  count: '件数',
  filter: '条件',
  from: '開始日',
  to: '終了日',
  has_photo: '写真あり',
  q: '検索語',
}
const FIELD_VALUE_MAP = {
  status: LABEL.reportStatus,
  role: LABEL.role,
  approval_status: LABEL.approval,
  area_type: LABEL.areaType,
}
function formatAuditValue(k, v) {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(なし)'
  if (typeof v === 'object') {
    const inner = formatAuditDetails(v)
    return inner ? `(${inner})` : '(なし)'
  }
  if (FIELD_VALUE_MAP[k]) return tr(FIELD_VALUE_MAP[k], v)
  return String(v)
}
function formatAuditDetails(details) {
  if (!details || typeof details !== 'object') return ''
  const parts = []
  for (const [k, v] of Object.entries(details)) {
    const label = FIELD_LABEL[k] ?? k
    parts.push(`${label}: ${formatAuditValue(k, v)}`)
  }
  return parts.join(' / ')
}

const SECTIONS = [
  { id: 'dashboard', label: 'ダッシュボード', icon: BarChart3 },
  { id: 'users',     label: 'ユーザー',       icon: Users },
  { id: 'reports',   label: '通報管理',       icon: FileText },
  { id: 'hotspots',  label: 'ホットスポット', icon: MapPin },
  { id: 'areas',     label: 'エリア',         icon: MapIcon },
  { id: 'audit',     label: '監査ログ',       icon: ClipboardList },
  { id: 'export',    label: 'エクスポート',   icon: Download },
]

export default function AdminPanel() {
  const [section, setSection] = useState('dashboard')

  return (
    <div className="admin-panel">
      <nav className="admin-nav">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`admin-nav-btn ${section === id ? 'active' : ''}`}
            onClick={() => setSection(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      <div className="admin-content">
        {section === 'dashboard' && <DashboardSection />}
        {section === 'users'     && <UsersSection />}
        {section === 'reports'   && <ReportsSection />}
        {section === 'hotspots'  && <HotspotsSection />}
        {section === 'areas'     && <AreasSection />}
        {section === 'audit'     && <AuditSection />}
        {section === 'export'    && <ExportSection />}
      </div>
    </div>
  )
}

// ============================================================================
// DASHBOARD
// ============================================================================
const DASHBOARD_STATS = [
  { key: 'total_reports', label: '通報数（合計）', desc: 'これまでに登録された通報の累計件数です。' },
  { key: 'reports_today', label: '本日の通報', accent: '#2e7d32', desc: '本日（0時以降）に受け付けた通報の件数です。' },
  { key: 'reports_week', label: '今週の通報', desc: '今週受け付けた通報の件数です。' },
  { key: 'reports_month', label: '今月の通報', desc: '今月受け付けた通報の件数です。' },
  { key: 'active_users', label: 'アクティブユーザー', desc: '有効化されている（停止されていない）利用者アカウントの数です。' },
  { key: 'pending_approvals', label: '承認待ち', accentIfPositive: '#d97706', desc: '承認待ちで、まだ地図機能を利用できない登録申請の数です。「ユーザー」から承認できます。' },
  { key: 'active_hotspots', label: 'アクティブHS', desc: '現在対応・観察中のホットスポット（要対応地点）の数です。' },
  { key: 'high_priority_hotspots', label: '高優先度HS', accent: '#c0392b', desc: '子猫がいるなど、優先的な対応が必要と判定されたホットスポットの数です。' },
  { key: 'completed_interventions', label: '完了介入', desc: '完了したTNR（捕獲・不妊去勢・返還）などの対応（介入）の累計件数です。' },
]

function DashboardSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openReportId, setOpenReportId] = useState(null)
  const [openStat, setOpenStat] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try { setData(await api.adminDashboard()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="admin-empty">読み込み中...</div>
  if (err) return <div className="admin-error">{err}</div>
  if (!data) return null

  const c = data.counts

  return (
    <>
      <div className="admin-section">
        <div className="admin-section-header">
          <h2><BarChart3 size={20} /> ダッシュボード</h2>
          <button className="admin-refresh" onClick={load}>
            <RefreshCw size={16} /> 更新
          </button>
        </div>

        <div className="stat-grid">
          {DASHBOARD_STATS.map((s) => {
            const accent = s.accentIfPositive ? (c[s.key] > 0 ? s.accentIfPositive : null) : s.accent
            return (
              <StatCard
                key={s.key}
                label={s.label}
                value={c[s.key]}
                accent={accent}
                onClick={() => setOpenStat({ ...s, value: c[s.key] })}
              />
            )
          })}
        </div>
      </div>

      <div className="admin-section">
        <h3 className="subhead">通報ステータス内訳</h3>
        <table className="admin-table">
          <thead><tr><th>ステータス</th><th>件数</th></tr></thead>
          <tbody>
            {data.reports_by_status.map((r) => (
              <tr key={r.status}><td>{tr(LABEL.reportStatus, r.status)}</td><td>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-section">
        <h3 className="subhead">エリア別 通報数（上位10）</h3>
        <table className="admin-table">
          <thead><tr><th>エリア</th><th>件数</th></tr></thead>
          <tbody>
            {data.reports_by_area.map((r, i) => (
              <tr key={i}><td>{r.area_name}</td><td>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-section">
        <h3 className="subhead">直近の通報</h3>
        <ul className="admin-list">
          {data.recent_reports.map((r) => {
            const latStr = r.latitude != null ? `${Math.abs(r.latitude).toFixed(4)}°${r.latitude >= 0 ? 'N' : 'S'}` : ''
            const lngStr = r.longitude != null ? `${Math.abs(r.longitude).toFixed(4)}°${r.longitude >= 0 ? 'E' : 'W'}` : ''
            return (
              <li
                key={r.id}
                className="admin-row admin-row-clickable"
                onClick={() => setOpenReportId(r.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpenReportId(r.id) }}
              >
                <div className="admin-row-info">
                  <div className="admin-row-name">
                    {r.id} — {r.reporter_name}
                    <span className={`pill pill-${r.status}`}>{tr(LABEL.reportStatus, r.status)}</span>
                    {r.photo_count > 0 && <span className="pill">📷 {r.photo_count}</span>}
                    {r.area_name && <span className="pill">{r.area_name}</span>}
                  </div>
                  <div className="admin-row-meta">
                    <span>{new Date(r.reported_at).toLocaleString('ja-JP')}</span>
                    {r.problem_types?.length > 0 && <span>問題: {r.problem_types.map((v) => tr(LABEL.problem, v)).join('、')}</span>}
                    <span>{latStr}, {lngStr}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {openReportId && (
        <ReportDetailModal
          id={openReportId}
          onClose={() => setOpenReportId(null)}
          onChanged={load}
        />
      )}

      {openStat && (
        <div className="modal-backdrop" onClick={() => setOpenStat(null)}>
          <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{openStat.label}</h3>
              <button onClick={() => setOpenStat(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="stat-modal-value">{openStat.value ?? '-'}</div>
              <p className="stat-modal-desc">{openStat.desc}</p>
              <div className="modal-actions">
                <button onClick={() => setOpenStat(null)}>閉じる</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="admin-section">
        <h3 className="subhead">月間 通報数 上位ユーザー</h3>
        <table className="admin-table">
          <thead><tr><th>ユーザー</th><th>メール</th><th>通報数</th></tr></thead>
          <tbody>
            {data.top_reporters.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.report_count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function StatCard({ label, value, accent, onClick }) {
  return (
    <button type="button" className="stat-card stat-card-clickable" onClick={onClick}>
      <div className="stat-value" style={accent ? { color: accent } : null}>{value ?? '-'}</div>
      <div className="stat-label">{label}</div>
    </button>
  )
}

// ============================================================================
// USERS
// ============================================================================
function UsersSection() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(null)
  const [areaModalUser, setAreaModalUser] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = {}
      if (q) params.q = q
      if (role) params.role = role
      if (status) params.status = status
      const data = await api.adminListUsers(params)
      setUsers(data.users || [])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [q, role, status])

  useEffect(() => { load() }, [load])

  async function updateUser(id, patch) {
    setBusy(id)
    try {
      await api.adminUpdateUser(id, patch)
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(null) }
  }

  async function deleteUser(id) {
    if (!confirm('本当にこのユーザーを削除しますか？認証情報も同時に削除されます。')) return
    setBusy(id)
    try {
      await api.adminDeleteUser(id)
      setUsers((prev) => prev.filter((u) => u.id !== id))
    } catch (e) { alert(e.message) }
    finally { setBusy(null) }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2><Users size={20} /> ユーザー管理</h2>
        <button className="admin-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> 更新
        </button>
      </div>

      <div className="filter-row">
        <div className="search-input">
          <Search size={14} />
          <input type="text" placeholder="名前/メールで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">全ロール</option>
          <option value="admin">{LABEL.role.admin}</option>
          <option value="member">{LABEL.role.member}</option>
          <option value="citizen">{LABEL.role.citizen}</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全ステータス</option>
          <option value="approved">{LABEL.approval.approved}</option>
          <option value="pending_approval">{LABEL.approval.pending_approval}</option>
          <option value="rejected">{LABEL.approval.rejected}</option>
        </select>
      </div>

      {err && <p className="admin-error">{err}</p>}
      {!loading && users.length === 0 && <p className="admin-empty">該当ユーザーがありません。</p>}

      <ul className="admin-list">
        {users.map((u) => (
          <li key={u.id} className="admin-row">
            <div className="admin-row-info">
              <div className="admin-row-name">
                {u.name} <span className={`pill pill-${u.role}`}>{tr(LABEL.role, u.role)}</span>
                <span className={`pill pill-${u.approval_status}`}>{tr(LABEL.approval, u.approval_status)}</span>
                {!u.is_active && <span className="pill pill-suspended">停止中</span>}
              </div>
              <div className="admin-row-meta">
                <span>{u.email}</span>
                {u.organization && <span>所属: {u.organization}</span>}
                <span>通報: {u.report_count}件</span>
                <span>管轄エリア: {u.area_count ?? 0}</span>
                <span>登録: {new Date(u.created_at).toLocaleDateString('ja-JP')}</span>
              </div>
            </div>
            <div className="admin-row-actions admin-actions-grid">
              <select
                value={u.role}
                disabled={busy === u.id}
                onChange={(e) => updateUser(u.id, { role: e.target.value })}
              >
                <option value="citizen">{LABEL.role.citizen}</option>
                <option value="member">{LABEL.role.member}</option>
                <option value="admin">{LABEL.role.admin}</option>
              </select>
              {u.approval_status !== 'approved' && (
                <button className="approve-btn" disabled={busy === u.id}
                  onClick={() => updateUser(u.id, { approval_status: 'approved' })}>
                  <Check size={14} /> 承認
                </button>
              )}
              {u.approval_status !== 'rejected' && (
                <button className="reject-btn" disabled={busy === u.id}
                  onClick={() => updateUser(u.id, { approval_status: 'rejected' })}>
                  <X size={14} /> 却下
                </button>
              )}
              <button className="toggle-btn" disabled={busy === u.id}
                onClick={() => updateUser(u.id, { is_active: !u.is_active })}>
                {u.is_active ? '停止' : '再開'}
              </button>
              <button className="toggle-btn" disabled={busy === u.id}
                onClick={() => setAreaModalUser(u)}>
                <MapIcon size={14} /> エリア
              </button>
              <button className="delete-btn" disabled={busy === u.id} onClick={() => deleteUser(u.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {areaModalUser && (
        <AreaAssignModal
          user={areaModalUser}
          onClose={() => setAreaModalUser(null)}
          onSaved={() => { setAreaModalUser(null); load() }}
        />
      )}
    </div>
  )
}

function AreaAssignModal({ user, onClose, onSaved }) {
  const [allAreas, setAllAreas] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([api.adminListAreas(), api.adminGetUserAreas(user.id)])
      .then(([all, mine]) => {
        if (!alive) return
        setAllAreas(all.areas || [])
        setSelected(new Set((mine.areas || []).map((a) => a.id)))
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [user.id])

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save() {
    setBusy(true)
    try {
      await api.adminSetUserAreas(user.id, Array.from(selected))
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{user.name} の管轄エリア</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {loading && <p className="admin-empty">読み込み中...</p>}
          {err && <p className="admin-error">{err}</p>}
          {!loading && allAreas.length === 0 && (
            <p className="admin-empty">先に「エリア」セクションでエリアを登録してください。</p>
          )}
          {!loading && allAreas.length > 0 && (
            <ul className="area-checklist">
              {allAreas.map((a) => (
                <li key={a.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span className="area-checklist-name">{a.name}</span>
                    <span className="pill">{tr(LABEL.areaType, a.area_type)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="modal-actions">
            <button onClick={onClose}>キャンセル</button>
            <button className="approve-btn" disabled={busy || loading} onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// REPORTS
// ============================================================================
function ReportsSection() {
  const [reports, setReports] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '', has_photo: '' })
  const [selected, setSelected] = useState(new Set())
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = { limit: 200 }
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
      const data = await api.adminListReports(params)
      setReports(data.reports || [])
      setTotal(data.total || 0)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [filters])

  useEffect(() => { load() }, [load])

  function toggleSel(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function bulkDelete() {
    if (!selected.size) return
    if (!confirm(`${selected.size}件の通報を削除しますか？`)) return
    setBusy(true)
    try {
      await api.adminBulkDeleteReports(Array.from(selected))
      setSelected(new Set())
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function deleteOne(id) {
    if (!confirm('この通報を削除しますか？')) return
    setBusy(true)
    try { await api.adminDeleteReport(id); await load() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function updateStatus(id, status) {
    setBusy(true)
    try { await api.adminUpdateReport(id, { status }); await load() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2><FileText size={20} /> 通報管理（{total}件）</h2>
        <button className="admin-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> 更新
        </button>
      </div>

      <div className="filter-row">
        <div className="search-input">
          <Search size={14} />
          <input type="text" placeholder="メモを検索" value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">全状態</option>
          <option value="pending">{LABEL.reportStatus.pending}</option>
          <option value="processed">{LABEL.reportStatus.processed}</option>
          <option value="discarded">{LABEL.reportStatus.discarded}</option>
        </select>
        <select value={filters.has_photo} onChange={(e) => setFilters({ ...filters, has_photo: e.target.value })}>
          <option value="">写真フィルタなし</option>
          <option value="true">写真あり</option>
          <option value="false">写真なし</option>
        </select>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          {selected.size}件 選択中
          <button className="delete-btn" disabled={busy} onClick={bulkDelete}>
            <Trash2 size={14} /> 一括削除
          </button>
          <button onClick={() => setSelected(new Set())}>解除</button>
        </div>
      )}

      {err && <p className="admin-error">{err}</p>}

      <ul className="admin-list">
        {reports.map((r) => (
          <li key={r.id} className="admin-row">
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={() => toggleSel(r.id)}
            />
            <div className="admin-row-info">
              <div className="admin-row-name">
                #{r.id} — {r.reporter_name}
                <span className={`pill pill-${r.status}`}>{tr(LABEL.reportStatus, r.status)}</span>
                {r.photo_count > 0 && <span className="pill">📷 {r.photo_count}</span>}
              </div>
              <div className="admin-row-meta">
                <span>{new Date(r.reported_at).toLocaleString('ja-JP')}</span>
                <span>{r.latitude?.toFixed(4)}, {r.longitude?.toFixed(4)}</span>
                {r.cat_count_range && <span>頭数: {r.cat_count_range}</span>}
                {r.notes && <span title={r.notes}>📝 {r.notes.slice(0, 30)}{r.notes.length > 30 ? '…' : ''}</span>}
              </div>
            </div>
            <div className="admin-row-actions admin-actions-grid">
              <select value={r.status} disabled={busy} onChange={(e) => updateStatus(r.id, e.target.value)}>
                <option value="pending">{LABEL.reportStatus.pending}</option>
                <option value="processed">{LABEL.reportStatus.processed}</option>
                <option value="discarded">{LABEL.reportStatus.discarded}</option>
              </select>
              <button className="toggle-btn" onClick={() => setOpenId(r.id)}>
                <Eye size={14} />
              </button>
              <button className="delete-btn" disabled={busy} onClick={() => deleteOne(r.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {openId && <ReportDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}

function ReportDetailModal({ id, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    let alive = true
    api.adminGetReport(id).then((d) => {
      if (!alive) return
      setData(d)
      setNotes(d.report.notes || '')
    }).catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [id])

  async function save() {
    try {
      await api.adminUpdateReport(id, { notes })
      onChanged?.()
      onClose()
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>通報 {id} 詳細</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {err && <p className="admin-error">{err}</p>}
        {!data && !err && <p className="admin-empty">読み込み中...</p>}
        {data && (
          <div className="modal-body">
            <DetailKV label="通報者"     value={`${data.report.reporter_name || '匿名'} (${data.report.reporter_email || '-'})`} />
            <DetailKV label="通報日時"   value={new Date(data.report.reported_at).toLocaleString('ja-JP')} />
            <DetailKV label="ステータス" value={<span className={`pill pill-${data.report.status}`}>{tr(LABEL.reportStatus, data.report.status)}</span>} />
            <DetailKV label="エリア"     value={data.report.area_name || '(エリア外)'} />
            <DetailKV label="座標"       value={fmtCoord(data.report.latitude, data.report.longitude)} />
            <DetailKV label="頭数"       value={data.report.cat_count_range ? tr(LABEL.catCount, data.report.cat_count_range) : '-'} />
            <DetailKV label="耳カット"   value={data.report.ear_cut_status ? tr(LABEL.earCut, data.report.ear_cut_status) : '-'} />
            <DetailKV label="子猫"       value={data.report.kitten_status ? tr(LABEL.kittenStatus, data.report.kitten_status) : '-'} />
            <DetailKV label="行動"       value={data.report.behavior || '-'} />
            <DetailKV label="問題"       value={trList(LABEL.problem, data.report.problem_types)} />
            <DetailKV label="要望"       value={trList(LABEL.request, data.report.requests)} />

            {data.media.length > 0 && (
              <div className="kv">
                <div className="kv-label">写真</div>
                <div className="photo-grid">
                  {data.media.map((m) => (
                    <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                      <img src={m.url} alt="" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="kv">
              <div className="kv-label">管理メモ</div>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="modal-actions">
              <button onClick={onClose}>閉じる</button>
              <button className="approve-btn" onClick={save}>保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailKV({ label, value }) {
  return (
    <div className="kv">
      <div className="kv-label">{label}</div>
      <div className="kv-value">{value}</div>
    </div>
  )
}

// ============================================================================
// HOTSPOTS
// ============================================================================
function HotspotsSection() {
  const [data, setData] = useState({ hotspots: [], last_refresh: null })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [cfg, setCfg] = useState({ days_back: 30, cluster_radius_meters: 100, min_points: 1, clear_existing: false })
  const [busy, setBusy] = useState(false)
  const [openHotspot, setOpenHotspot] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try { setData(await api.adminListHotspots()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function refresh() {
    if (cfg.clear_existing && !confirm('既存のホットスポットを全削除して再生成しますか？')) return
    setBusy(true)
    try {
      const r = await api.adminRefreshHotspots(cfg)
      alert(`再生成完了: ${r.hotspots_created} 件`)
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function del(id) {
    if (!confirm('このホットスポットを削除しますか？')) return
    try { await api.adminDeleteHotspot(id); await load() }
    catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="admin-section">
        <div className="admin-section-header">
          <h2><MapPin size={20} /> ホットスポット再生成</h2>
          <span style={{ fontSize: 12, color: '#777' }}>
            最終生成: {data.last_refresh ? new Date(data.last_refresh).toLocaleString('ja-JP') : '-'}
          </span>
        </div>
        <div className="filter-row">
          <label>遡及日数
            <input type="number" min="1" value={cfg.days_back}
              onChange={(e) => setCfg({ ...cfg, days_back: Number(e.target.value) })} />
          </label>
          <label>クラスタ半径(m)
            <input type="number" min="10" value={cfg.cluster_radius_meters}
              onChange={(e) => setCfg({ ...cfg, cluster_radius_meters: Number(e.target.value) })} />
          </label>
          <label>最小通報数
            <input type="number" min="1" value={cfg.min_points}
              onChange={(e) => setCfg({ ...cfg, min_points: Number(e.target.value) })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={cfg.clear_existing}
              onChange={(e) => setCfg({ ...cfg, clear_existing: e.target.checked })} />
            既存を削除して再生成
          </label>
          <button className="approve-btn" disabled={busy} onClick={refresh}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> 再生成実行
          </button>
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-section-header">
          <h2><MapPin size={20} /> ホットスポット一覧（{data.hotspots.length}）</h2>
          <button className="admin-refresh" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> 更新
          </button>
        </div>
        {err && <p className="admin-error">{err}</p>}
        <ul className="admin-list">
          {data.hotspots.map((h) => (
            <li key={h.id} className="admin-row">
              <div
                className="admin-row-info admin-row-clickable"
                onClick={() => setOpenHotspot(h)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpenHotspot(h) }}
              >
                <div className="admin-row-name">
                  {h.id}
                  <span className={`pill pill-${h.status}`}>{tr(LABEL.hotspotStatus, h.status)}</span>
                  {h.has_kitten && <span className="pill">子猫</span>}
                  {h.has_ear_cut_visible && <span className="pill">耳カット</span>}
                </div>
                <div className="admin-row-meta">
                  <span>通報数: {h.report_count}</span>
                  <span>推定頭数: {h.cat_count_estimate}</span>
                  <span>{h.area_name || 'エリア外'}</span>
                  <span>最終: {h.last_seen_at ? new Date(h.last_seen_at).toLocaleDateString('ja-JP') : '-'}</span>
                  <span>{fmtCoord(h.latitude, h.longitude)}</span>
                </div>
              </div>
              <div className="admin-row-actions">
                <button className="delete-btn" onClick={() => del(h.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {openHotspot && (
        <HotspotDetailModal hotspot={openHotspot} onClose={() => setOpenHotspot(null)} />
      )}
    </>
  )
}

function HotspotDetailModal({ hotspot, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    api.getHotspot(hotspot.id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message))
    return () => { alive = false }
  }, [hotspot.id])

  const photos = (data?.reports || []).flatMap((r) =>
    (r.media_urls || []).map((url) => ({ url, reportId: r.id }))
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>ホットスポット {hotspot.id} 詳細</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <DetailKV label="ステータス" value={<span className={`pill pill-${hotspot.status}`}>{tr(LABEL.hotspotStatus, hotspot.status)}</span>} />
          <DetailKV label="通報数"     value={hotspot.report_count} />
          <DetailKV label="推定頭数"   value={hotspot.cat_count_estimate ?? '-'} />
          <DetailKV label="子猫"       value={hotspot.has_kitten ? 'あり' : 'なし'} />
          <DetailKV label="耳カット"   value={hotspot.has_ear_cut_visible ? '確認済' : '未確認'} />
          <DetailKV label="エリア"     value={hotspot.area_name || '(エリア外)'} />
          <DetailKV label="座標"       value={fmtCoord(hotspot.latitude, hotspot.longitude)} />
          <DetailKV label="最終確認"   value={hotspot.last_seen_at ? new Date(hotspot.last_seen_at).toLocaleString('ja-JP') : '-'} />

          {err && <p className="admin-error">{err}</p>}

          <div className="kv">
            <div className="kv-label">紐づく通報</div>
            <div className="kv-value">
              {!data && !err && '読み込み中...'}
              {data && data.reports.length === 0 && '通報はありません'}
              {data && data.reports.map((r) => (
                <div key={r.id} className="hs-report-line">
                  <span>#{r.id}</span>
                  <span className={`pill pill-${r.status}`}>{tr(LABEL.reportStatus, r.status)}</span>
                  <span>{new Date(r.reported_at).toLocaleDateString('ja-JP')}</span>
                  {r.notes && <span title={r.notes}>📝 {r.notes.slice(0, 24)}{r.notes.length > 24 ? '…' : ''}</span>}
                </div>
              ))}
            </div>
          </div>

          {photos.length > 0 && (
            <div className="kv">
              <div className="kv-label">写真（{photos.length}）</div>
              <div className="photo-grid">
                {photos.map((p, i) => (
                  <a key={`${p.url}-${i}`} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt={`通報 #${p.reportId}`} />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button onClick={onClose}>閉じる</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// AREAS
// ============================================================================
function AreasSection() {
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [openedId, setOpenedId] = useState(null)
  const [form, setForm] = useState({ name: '', area_type: 'district', description: '', geojsonObj: null })

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try { const d = await api.adminListAreas(); setAreas(d.areas || []) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function create() {
    if (!form.name.trim()) return alert('名前を入力してください')
    if (!form.geojsonObj) return alert('地図上で3点以上をクリックしてエリアの範囲を指定してください')
    try {
      await api.adminCreateArea({
        name: form.name,
        area_type: form.area_type,
        description: form.description,
        geometry_geojson: form.geojsonObj,
      })
      setCreating(false)
      setForm({ name: '', area_type: 'district', description: '', geojsonObj: null })
      await load()
    } catch (e) { alert(e.message) }
  }

  async function del(id) {
    if (!confirm('このエリアを削除しますか？')) return
    try { await api.adminDeleteArea(id); await load() }
    catch (e) { alert(e.message) }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2><MapIcon size={20} /> エリア管理（{areas.length}）</h2>
        <button className="approve-btn" onClick={() => setCreating(!creating)}>
          {creating ? 'キャンセル' : '新規追加'}
        </button>
      </div>

      {creating && (
        <div className="form-card">
          <label>名前
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>種別
            <select value={form.area_type} onChange={(e) => setForm({ ...form, area_type: e.target.value })}>
              <option value="district">{LABEL.areaType.district}</option>
              <option value="ward">{LABEL.areaType.ward}</option>
              <option value="city">{LABEL.areaType.city}</option>
              <option value="custom">{LABEL.areaType.custom}</option>
            </select>
          </label>
          <label>説明
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>エリア範囲（地図上を順にクリックして3点以上で囲んでください）
            <AreaPolygonPicker
              value={form.geojsonObj}
              onChange={(g) => setForm({ ...form, geojsonObj: g })}
            />
          </label>
          <button className="approve-btn" onClick={create}>作成</button>
        </div>
      )}

      {err && <p className="admin-error">{err}</p>}
      {!loading && areas.length === 0 && <p className="admin-empty">エリアが登録されていません。</p>}

      <ul className="admin-list">
        {areas.map((a) => {
          const open = openedId === a.id
          const hasCenter = a.lat != null && a.lng != null
          const latStr = hasCenter ? `${Math.abs(a.lat).toFixed(4)}°${a.lat >= 0 ? 'N' : 'S'}` : ''
          const lngStr = hasCenter ? `${Math.abs(a.lng).toFixed(4)}°${a.lng >= 0 ? 'E' : 'W'}` : ''
          return (
            <li key={a.id} className="admin-row">
              <div className="admin-row-info">
                <div className="admin-row-name">
                  {a.name} <span className="pill">{tr(LABEL.areaType, a.area_type)}</span>
                </div>
                <div className="admin-row-meta">
                  {a.description && <span>{a.description}</span>}
                  {a.responsible_name && <span>担当: {a.responsible_name}</span>}
                  {hasCenter && (
                    <button
                      type="button"
                      className="area-center-link"
                      onClick={() => setOpenedId(open ? null : a.id)}
                    >
                      中心座標: {latStr}, {lngStr}
                    </button>
                  )}
                </div>
                {open && hasCenter && <AreaPreviewMap lat={a.lat} lng={a.lng} name={a.name} />}
              </div>
              <div className="admin-row-actions">
                <button className="delete-btn" onClick={() => del(a.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AreaPreviewMap({ lat, lng, name }) {
  const containerRef = useRef(null)
  useEffect(() => {
    if (!containerRef.current) return
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([lat, lng], 13)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &copy; CARTO',
    }).addTo(map)
    L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'area-center-marker',
        html: '<div class="area-center-pin"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    }).addTo(map).bindTooltip(name, { permanent: false, direction: 'top', offset: [0, -8] })
    setTimeout(() => map.invalidateSize(), 50)
    return () => map.remove()
  }, [lat, lng, name])
  return <div ref={containerRef} className="area-preview-map" />
}

function AreaPolygonPicker({ value, onChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const pointsRef = useRef([])
  const onChangeRef = useRef(onChange)
  const [count, setCount] = useState(0)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const rebuild = useCallback(() => {
    if (!layerRef.current) return
    layerRef.current.clearLayers()
    const pts = pointsRef.current
    pts.forEach((p) => {
      L.circleMarker(p, { radius: 5, color: '#1a73e8', fillColor: '#1a73e8', fillOpacity: 1, weight: 2 })
        .addTo(layerRef.current)
    })
    if (pts.length >= 2 && pts.length < 3) {
      L.polyline(pts, { color: '#1a73e8', weight: 3 }).addTo(layerRef.current)
    }
    if (pts.length >= 3) {
      L.polygon(pts, { color: '#1a73e8', fillColor: '#1a73e8', fillOpacity: 0.18, weight: 2 })
        .addTo(layerRef.current)
      const ring = pts.map(([lat, lng]) => [lng, lat])
      ring.push(ring[0])
      onChangeRef.current({ type: 'Polygon', coordinates: [ring] })
    } else {
      onChangeRef.current(null)
    }
  }, [])

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current).setView([35.6762, 139.6503], 11)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &copy; CARTO',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e) => {
      pointsRef.current = [...pointsRef.current, [e.latlng.lat, e.latlng.lng]]
      setCount(pointsRef.current.length)
      rebuild()
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 50)
    return () => { map.remove(); mapRef.current = null }
  }, [rebuild])

  useEffect(() => {
    if (value == null && pointsRef.current.length > 0) {
      pointsRef.current = []
      setCount(0)
      rebuild()
    }
  }, [value, rebuild])

  function undo() {
    pointsRef.current = pointsRef.current.slice(0, -1)
    setCount(pointsRef.current.length)
    rebuild()
  }
  function clear() {
    pointsRef.current = []
    setCount(0)
    rebuild()
  }

  return (
    <div className="area-picker">
      <div className="area-picker-toolbar">
        <span className="area-picker-count">{count} 点配置中{count >= 3 ? '（範囲確定）' : count > 0 ? `（あと${Math.max(0, 3 - count)}点）` : ''}</span>
        <button type="button" className="toggle-btn" onClick={undo} disabled={count === 0}>1点戻す</button>
        <button type="button" className="toggle-btn" onClick={clear} disabled={count === 0}>クリア</button>
      </div>
      <div ref={containerRef} className="area-picker-map" />
    </div>
  )
}

// ============================================================================
// AUDIT
// ============================================================================
function AuditSection() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filterAction, setFilterAction] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = { limit: 200 }
      if (filterAction) params.action = filterAction
      const d = await api.adminAuditLog(params)
      setEntries(d.entries || [])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [filterAction])
  useEffect(() => { load() }, [load])

  const actions = useMemo(() => Array.from(new Set(entries.map((e) => e.action))), [entries])

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2><ClipboardList size={20} /> 監査ログ</h2>
        <button className="admin-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> 更新
        </button>
      </div>
      <div className="filter-row">
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
          <option value="">全アクション</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {err && <p className="admin-error">{err}</p>}
      {!loading && entries.length === 0 && <p className="admin-empty">ログがありません。</p>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>日時</th><th>実行者</th><th>アクション</th><th>対象</th><th>詳細</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString('ja-JP')}</td>
              <td>{e.actor_email || `#${e.actor_user_id}`}</td>
              <td>{e.action}</td>
              <td>{e.target_type} {e.target_id && `#${e.target_id}`}</td>
              <td><span className="audit-details">{formatAuditDetails(e.details)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// EXPORT
// ============================================================================
function ExportSection() {
  const [filters, setFilters] = useState({ from: '', to: '', status: '' })
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const params = {}
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
      const blob = await api.adminExportReportsCsv(params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2><Download size={20} /> 通報CSVエクスポート</h2>
      </div>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 14 }}>
        市役所への報告用にフィルタを設定してCSVをダウンロードできます。
      </p>
      <div className="filter-row">
        <label>開始日
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label>終了日
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">全ステータス</option>
          <option value="pending">{LABEL.reportStatus.pending}</option>
          <option value="processed">{LABEL.reportStatus.processed}</option>
          <option value="discarded">{LABEL.reportStatus.discarded}</option>
        </select>
        <button className="approve-btn" disabled={busy} onClick={download}>
          <Download size={14} /> ダウンロード
        </button>
      </div>
    </div>
  )
}
