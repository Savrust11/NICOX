import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, CheckCircle, Eye, MapPin, Stethoscope } from 'lucide-react'
import { api } from '../lib/api'
import './PublicStats.css'

export default function PublicStats() {
  const [stats, setStats] = useState(null)
  const [areas, setAreas] = useState([])
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      api.getPublicStats(selectedAreaId || undefined),
      api.getPublicAreas(),
    ])
      .then(([s, a]) => {
        if (!alive) return
        setStats(s.stats)
        setAreas(a.areas || [])
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [selectedAreaId])

  const selectedArea = useMemo(
    () => areas.find((a) => String(a.id) === String(selectedAreaId)),
    [areas, selectedAreaId]
  )

  return (
    <div className="public-stats">
      <div className="ps-hero">
        <h1>NICOX 地域猫マネジメント</h1>
        <p>地域の野良猫問題に取り組むためのプラットフォームです。</p>
      </div>

      {areas.length > 0 && (
        <div className="ps-section">
          <h2><MapPin size={18} /> 市町村を選択</h2>
          <div className="ps-area-selector">
            <button
              className={`ps-area-chip ${!selectedAreaId ? 'active' : ''}`}
              onClick={() => setSelectedAreaId('')}
            >全体</button>
            {areas.map((a) => (
              <button
                key={a.id}
                className={`ps-area-chip ${String(selectedAreaId) === String(a.id) ? 'active' : ''}`}
                onClick={() => setSelectedAreaId(a.id)}
              >
                {a.name}
                <span className="ps-area-count">{a.total_reports}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ps-section">
        <h2>
          <BarChart3 size={18} /> 現在の活動状況
          {selectedArea && <span className="ps-area-tag">{selectedArea.name}</span>}
        </h2>
        {loading && <p className="ps-loading">読み込み中...</p>}
        {err && <p className="ps-error">統計の読み込みに失敗しました</p>}
        {stats && !loading && (
          <div className="ps-grid">
            <Card icon={<MapPin size={20} />} label="通報総数" value={stats.total_reports} color="#3498db" />
            <Card icon={<Eye size={20} />} label="未対応の通報" value={stats.pending_reports} color="#f39c12" />
            <Card icon={<AlertTriangle size={20} />} label="要対応エリア" value={stats.high_priority_hotspots} color="#e74c3c" />
            <Card icon={<MapPin size={20} />} label="活動中のエリア" value={stats.active_hotspots} color="#9b59b6" />
            <Card icon={<Stethoscope size={20} />} label="対応済み介入" value={stats.completed_interventions} color="#16a085" />
            <Card icon={<CheckCircle size={20} />} label="解決済みエリア" value={stats.resolved_hotspots} color="#27ae60" />
          </div>
        )}
      </div>

      {!selectedAreaId && areas.length > 0 && (
        <div className="ps-section">
          <h2><MapPin size={18} /> 市町村別 通報状況</h2>
          <table className="ps-area-table">
            <thead>
              <tr>
                <th>市町村</th>
                <th>通報数</th>
                <th>未対応</th>
                <th>活動エリア</th>
                <th>要対応</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button className="ps-area-link" onClick={() => setSelectedAreaId(a.id)}>
                      {a.name}
                    </button>
                  </td>
                  <td>{a.total_reports}</td>
                  <td>{a.pending_reports}</td>
                  <td>{a.active_hotspots}</td>
                  <td>{a.high_priority_hotspots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ps-cta">
        <h2>活動者・行政関係者の方へ</h2>
        <p>
          通報内容（場所・写真・詳細情報）の閲覧には、活動者・関係者として登録いただき、
          管理者の承認を経てログインしていただく必要があります。
          動物愛護の観点から、位置情報を含む詳細データの取り扱いには慎重を期しています。
        </p>
      </div>
    </div>
  )
}

function Card({ icon, label, value, color }) {
  return (
    <div className="ps-card" style={{ borderLeftColor: color }}>
      <div className="ps-card-icon" style={{ color }}>{icon}</div>
      <div className="ps-card-body">
        <div className="ps-card-value">{value ?? '-'}</div>
        <div className="ps-card-label">{label}</div>
      </div>
    </div>
  )
}
