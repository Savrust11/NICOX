import { useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, CheckCircle, Eye, MapPin, Stethoscope, UserCircle, X } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import './PublicStats.css'

const ROLE_LABEL = { admin: '管理者', member: '活動者', citizen: '市民' }
const APPROVAL_LABEL = { approved: '承認済み', pending_approval: '承認待ち', rejected: '却下' }

// Stat cards with their detail descriptions, shown in a popup on click.
const STAT_CARDS = [
  { key: 'total_reports', icon: <MapPin size={20} />, label: '通報総数', color: '#3498db', desc: 'これまでに寄せられた通報の累計件数です。' },
  { key: 'pending_reports', icon: <Eye size={20} />, label: '未対応の通報', color: '#f39c12', desc: 'まだ対応が完了していない通報の件数です。早期の確認・対応が望まれる項目です。' },
  { key: 'high_priority_hotspots', icon: <AlertTriangle size={20} />, label: '要対応エリア', color: '#e74c3c', desc: '子猫がいるなど、優先的な対応が必要と判定されたエリアの数です。' },
  { key: 'active_hotspots', icon: <MapPin size={20} />, label: '活動中のエリア', color: '#9b59b6', desc: '現在、対応や経過観察を進めているエリアの数です。' },
  { key: 'completed_interventions', icon: <Stethoscope size={20} />, label: '対応済み介入', color: '#16a085', desc: '完了したTNR（捕獲・不妊去勢・返還）などの対応（介入）の累計件数です。' },
  { key: 'resolved_hotspots', icon: <CheckCircle size={20} />, label: '解決済みエリア', color: '#27ae60', desc: '対応が完了し、解決済みとなったエリアの数です。' },
]

export default function PublicStats() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.getPublicStats()
      .then((s) => { if (alive) setStats(s.stats) })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  return (
    <div className="public-stats">
      <div className="ps-hero">
        <h1>NICOX 地域猫マネジメント</h1>
        <p>地域の野良猫問題に取り組むためのプラットフォームです。</p>
      </div>

      {user && (
        <div className="ps-account">
          <div className="ps-account-avatar"><UserCircle size={32} /></div>
          <div className="ps-account-body">
            <div className="ps-account-name">{user.name} さん</div>
            <div className="ps-account-badges">
              <span className="ps-badge ps-badge-role">{ROLE_LABEL[user.role] || user.role}</span>
              <span className="ps-badge">{APPROVAL_LABEL[user.approval_status] || user.approval_status}</span>
              {user.organization && <span className="ps-badge">{user.organization}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="ps-section">
        <h2><BarChart3 size={18} /> 現在の活動状況</h2>
        {loading && <p className="ps-loading">読み込み中...</p>}
        {err && <p className="ps-error">統計の読み込みに失敗しました</p>}
        {stats && !loading && (
          <div className="ps-grid">
            {STAT_CARDS.map((card) => (
              <Card
                key={card.key}
                icon={card.icon}
                label={card.label}
                value={stats[card.key]}
                color={card.color}
                onClick={() => setDetail({ ...card, value: stats[card.key] })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="ps-cta">
        <h2>活動者・行政関係者の方へ</h2>
        <p>
          通報内容（場所・写真・詳細情報）の閲覧には、活動者・関係者として登録いただき、
          管理者の承認を経てログインしていただく必要があります。
          動物愛護の観点から、位置情報を含む詳細データの取り扱いには慎重を期しています。
        </p>
      </div>

      {detail && (
        <div className="ps-modal-backdrop" onClick={() => setDetail(null)}>
          <div className="ps-modal" onClick={(e) => e.stopPropagation()}>
            <button className="ps-modal-close" onClick={() => setDetail(null)} aria-label="閉じる">
              <X size={18} />
            </button>
            <div className="ps-modal-icon" style={{ color: detail.color }}>{detail.icon}</div>
            <div className="ps-modal-value" style={{ color: detail.color }}>{detail.value ?? '-'}</div>
            <div className="ps-modal-label">{detail.label}</div>
            <p className="ps-modal-desc">{detail.desc}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ icon, label, value, color, onClick }) {
  return (
    <button type="button" className="ps-card" style={{ borderLeftColor: color }} onClick={onClick}>
      <div className="ps-card-icon" style={{ color }}>{icon}</div>
      <div className="ps-card-body">
        <div className="ps-card-value">{value ?? '-'}</div>
        <div className="ps-card-label">{label}</div>
      </div>
    </button>
  )
}
