import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, CheckCircle2, MapPin, X } from 'lucide-react'
import { api } from '../lib/api'
import { compressImage, formatBytes } from '../lib/compress'
import './ReportForm.css'

const LOCATE_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
const DEFAULT_CENTER = [35.6814, 139.7670]

const PROBLEM_TYPES = [
  { value: 'waste', label: '糞尿' },
  { value: 'kittens', label: '子猫' },
  { value: 'noise', label: '鳴き声' },
  { value: 'unfixed', label: '未手術猫' },
  { value: 'feeding', label: '餌やり問題' },
]

const CAT_COUNT_RANGES = [
  { value: '1-3', label: '1〜3' },
  { value: '4-10', label: '4〜10' },
  { value: '10+', label: '10以上' },
  { value: 'unknown', label: '不明' },
]

const EAR_CUT_STATUSES = [
  { value: 'all', label: '全てあり' },
  { value: 'some', label: '一部あり' },
  { value: 'none', label: 'なし' },
  { value: 'unknown', label: '不明' },
]

const KITTEN_STATUSES = [
  { value: 'present', label: 'いる' },
  { value: 'absent', label: 'いない' },
  { value: 'unknown', label: '不明' },
]

const INVOLVEMENT_LEVELS = [
  { value: 'info_only', label: '情報提供のみ' },
  { value: 'capture_help', label: '捕獲協力可能' },
  { value: 'ongoing_involvement', label: '継続的に関与可能' },
]

const FUNDING_LEVELS = [
  { value: 'none', label: '負担不可' },
  { value: 'partial', label: '一部可能' },
  { value: 'full', label: '全額可能' },
]

const REQUESTS = [
  { value: 'reduce_damage', label: '被害を減らしたい' },
  { value: 'want_surgery', label: '手術したい' },
  { value: 'immediate', label: 'すぐ対応してほしい' },
]

const INITIAL_FIELDS = {
  problem_types: [],
  cat_count_range: '',
  ear_cut_status: '',
  kitten_status: '',
  notes: '',
  involvement_level: '',
  funding_level: '',
  funding_amount: '',
  requests: [],
  is_anonymous: false,
}

const reportIcon = L.divIcon({
  className: 'report-marker',
  html: '<div class="report-pin"></div>',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
})

const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<div class="user-location-pulse"></div><div class="user-location-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function Select({ name, options, value, onChange, placeholder = '選択してください', required }) {
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function ChipMulti({ options, values, onChange }) {
  return (
    <div className="chip-row">
      {options.map((opt) => {
        const checked = values.includes(opt.value)
        return (
          <label key={opt.value} className={`chip ${checked ? 'on' : ''}`}>
            <input
              type="checkbox"
              value={opt.value}
              checked={checked}
              onChange={() =>
                onChange(checked ? values.filter((v) => v !== opt.value) : [...values, opt.value])
              }
              className="chip-input"
            />
            <span>{opt.label}</span>
          </label>
        )
      })}
    </div>
  )
}

export default function ReportForm({ onSuccess }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const marker = useRef(null)
  const userMarker = useRef(null)
  const accuracyCircle = useRef(null)

  const [location, setLocation] = useState(null)
  const [fields, setFields] = useState(INITIAL_FIELDS)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (map.current || !mapContainer.current) return
    map.current = L.map(mapContainer.current).setView(DEFAULT_CENTER, 13)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map.current)

    const locateBtn = L.control({ position: 'topright' })
    locateBtn.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control')
      div.innerHTML = `<a href="#" title="現在地" class="leaflet-icon-btn">${LOCATE_ICON_SVG}</a>`
      L.DomEvent.disableClickPropagation(div)
      div.onclick = (e) => {
        e.preventDefault()
        map.current.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true })
      }
      return div
    }
    locateBtn.addTo(map.current)

    map.current.on('error', (e) => console.error('Map error:', e))
    map.current.on('click', (e) => {
      const { lng, lat } = e.latlng
      setLocation({ longitude: lng, latitude: lat })
      if (marker.current) {
        marker.current.setLatLng([lat, lng])
      } else {
        marker.current = L.marker([lat, lng], { icon: reportIcon, draggable: true }).addTo(map.current)
        marker.current.on('dragend', () => {
          const { lat: lat2, lng: lng2 } = marker.current.getLatLng()
          setLocation({ longitude: lng2, latitude: lat2 })
        })
      }
    })

    map.current.on('locationfound', (e) => {
      const { lat, lng } = e.latlng
      if (userMarker.current) {
        userMarker.current.setLatLng([lat, lng])
        accuracyCircle.current.setLatLng([lat, lng]).setRadius(e.accuracy)
      } else {
        userMarker.current = L.marker([lat, lng], { icon: userLocationIcon, interactive: false })
          .addTo(map.current)
        accuracyCircle.current = L.circle([lat, lng], {
          radius: e.accuracy,
          weight: 1,
          color: '#4285f4',
          fillColor: '#4285f4',
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(map.current)
      }
    })

    map.current.on('locationerror', (e) => {
      alert('現在地を取得できませんでした: ' + e.message)
    })

    setTimeout(() => map.current?.invalidateSize(), 100)

    return () => {
      map.current?.remove()
      map.current = null
      marker.current = null
    }
  }, [])

  const resetForm = useCallback(() => {
    setLocation(null)
    setFields(INITIAL_FIELDS)
    setPhoto(null)
    setPhotoPreview(null)
    setStatus('idle')
    setErrorMsg('')
    if (marker.current) {
      marker.current.remove()
      marker.current = null
    }
  }, [])

  async function handlePhotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setStatus('compressing')
    const compressed = await compressImage(file)
    setPhoto(compressed)
    setPhotoPreview(URL.createObjectURL(compressed))
    setStatus('idle')
  }

  function set(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const missing = []
    if (!location) missing.push('場所')
    if (fields.problem_types.length === 0) missing.push('問題内容')
    if (!fields.cat_count_range) missing.push('頭数')
    if (!fields.ear_cut_status) missing.push('耳カット')
    if (!fields.kitten_status) missing.push('子猫')
    if (!fields.involvement_level) missing.push('関与意思')
    if (!fields.funding_level) missing.push('費用負担')
    if (
      (fields.funding_level === 'partial' || fields.funding_level === 'full') &&
      !fields.funding_amount
    ) {
      missing.push('金額')
    }
    if (fields.requests.length === 0) missing.push('要望')

    if (missing.length > 0) {
      setErrorMsg(`次の項目を入力してください: ${missing.join('、')}`)
      return
    }
    setStatus('submitting')
    setErrorMsg('')
    try {
      const { id } = await api.submitReport({
        ...location,
        problem_types: fields.problem_types,
        cat_count_range: fields.cat_count_range || undefined,
        ear_cut_status: fields.ear_cut_status || undefined,
        kitten_status: fields.kitten_status || undefined,
        notes: fields.notes || undefined,
        involvement_level: fields.involvement_level || undefined,
        funding_level: fields.funding_level || undefined,
        funding_amount: fields.funding_amount || undefined,
        requests: fields.requests,
        is_anonymous: fields.is_anonymous,
      })
      if (photo) await api.uploadMedia(id, photo)
      setStatus('success')
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="success-screen">
        <CheckCircle2 size={64} strokeWidth={1.5} color="#27ae60" />
        <h2>通報を送信しました</h2>
        <p>ご協力ありがとうございます。</p>
        <div className="success-actions">
          <button className="btn-primary" onClick={resetForm}>続けて通報する</button>
          <button className="btn-secondary" onClick={onSuccess}>地図を見る</button>
        </div>
      </div>
    )
  }

  return (
    <div className="report-form">
      <div className="map-picker" ref={mapContainer} />
      <div className="map-hint">
        {location ? (
          <>
            <MapPin size={14} strokeWidth={2.5} />
            <span>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}（ドラッグで調整可）</span>
          </>
        ) : (
          '地図をタップして場所を指定してください'
        )}
      </div>

      <form className="fields" onSubmit={handleSubmit}>
        {/* 問題内容 + 要望 (multi, side by side) */}
        <div className="grid-2">
          <div className="field">
            <label>問題内容 <span className="req">*</span></label>
            <ChipMulti
              options={PROBLEM_TYPES}
              values={fields.problem_types}
              onChange={(v) => set('problem_types', v)}
            />
          </div>
          <div className="field">
            <label>要望 <span className="req">*</span></label>
            <ChipMulti
              options={REQUESTS}
              values={fields.requests}
              onChange={(v) => set('requests', v)}
            />
          </div>
        </div>

        {/* 頭数 / 耳カット / 子猫 — 3 col on wide, 2 col on tablet, 1 col on mobile */}
        <div className="grid-3">
          <div className="field">
            <label>頭数 <span className="req">*</span></label>
            <Select name="cat_count_range" options={CAT_COUNT_RANGES}
              value={fields.cat_count_range} onChange={(v) => set('cat_count_range', v)} required />
          </div>
          <div className="field">
            <label>耳カット <span className="req">*</span></label>
            <Select name="ear_cut_status" options={EAR_CUT_STATUSES}
              value={fields.ear_cut_status} onChange={(v) => set('ear_cut_status', v)} required />
          </div>
          <div className="field">
            <label>子猫 <span className="req">*</span></label>
            <Select name="kitten_status" options={KITTEN_STATUSES}
              value={fields.kitten_status} onChange={(v) => set('kitten_status', v)} required />
          </div>
        </div>

        {/* 関与意思 / 費用負担 */}
        <div className="grid-2">
          <div className="field">
            <label>関与意思 <span className="req">*</span></label>
            <Select name="involvement_level" options={INVOLVEMENT_LEVELS}
              value={fields.involvement_level} onChange={(v) => set('involvement_level', v)} required />
          </div>
          <div className="field">
            <label>費用負担 <span className="req">*</span></label>
            <Select name="funding_level" options={FUNDING_LEVELS}
              value={fields.funding_level} onChange={(v) => set('funding_level', v)} required />
            {(fields.funding_level === 'partial' || fields.funding_level === 'full') && (
              <input
                className="amount-input"
                type="number" min="0" placeholder="金額（円） *" inputMode="numeric"
                value={fields.funding_amount}
                onChange={(e) => set('funding_amount', e.target.value)}
                required
              />
            )}
          </div>
        </div>

        {/* メモ + 匿名で通報 (left) / 写真 (right) */}
        <div className="grid-2 align-stretch">
          <div className="field-group">
            <div className="field">
              <label>メモ（任意）</label>
              <textarea rows={2} placeholder="気になる点、詳細など"
                value={fields.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <div className="chip-row">
              <label className={`chip ${fields.is_anonymous ? 'on' : ''}`}>
                <input type="checkbox" checked={fields.is_anonymous}
                  onChange={(e) => set('is_anonymous', e.target.checked)} className="chip-input" />
                <span>匿名で通報</span>
              </label>
            </div>
          </div>
          <div className="field photo-field">
            <div className="photo-label-side">
              <label>写真（任意）</label>
              <div className="photo-info">
                {status === 'compressing' && <p className="hint">圧縮中...</p>}
                {photo && <p className="hint">{formatBytes(photo.size)}</p>}
              </div>
            </div>
            <div className="photo-square">
              {photoPreview ? (
                <div className="photo-square-img">
                  <img src={photoPreview} alt="preview" />
                  <button type="button" className="photo-remove"
                    onClick={() => { setPhoto(null); setPhotoPreview(null) }}
                    aria-label="写真を削除">
                    <X size={14} strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <label className="photo-square-add">
                  <Camera size={28} strokeWidth={1.6} />
                  <span>追加</span>
                  <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} hidden />
                </label>
              )}
            </div>
          </div>
        </div>

        {errorMsg && <p className="error">{errorMsg}</p>}

        <button
          type="submit"
          className="submit-btn"
          disabled={status === 'submitting' || status === 'compressing'}
        >
          {status === 'submitting' ? '送信中...' : status === 'compressing' ? '画像処理中...' : '通報を送信する'}
        </button>
      </form>
    </div>
  )
}
