# NICOX — Stray Cat Management System

A geospatial reporting & hotspot-detection platform for stray cat populations.
Citizens submit sightings with location + photo through a React UI; the system
clusters nearby reports into "hotspots" (DBSCAN) so field staff can prioritize
TNR interventions.

**Production**: https://nicox.vercel.app

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, Leaflet (OpenStreetMap / CartoDB tiles), Lucide icons |
| API | Node.js 20+, Express |
| Database | PostgreSQL 17 with PostGIS 3+ ([Supabase](https://supabase.com)) |
| Scheduling | [pg_cron](https://github.com/citusdata/pg_cron) inside Supabase |
| Image storage | [Supabase Storage](https://supabase.com) (same project) |
| Hosting | [Vercel](https://vercel.com) (serverless function serves both API and SPA) |

## Repository layout

```
api/         Node.js Express API (Vercel serverless entrypoint, also serves built SPA from api/public/)
db/          PostgreSQL + PostGIS schema
frontend/    React + Vite SPA (citizen reporting + staff map view)
vercel.json  Vercel build configuration
```

## Setup

### 1. Create the Supabase project

1. Sign up at https://supabase.com and create a project (region: `Northeast Asia (Tokyo)` or closest).
2. **Database → Extensions** → enable `postgis` and `pg_cron`.
3. **Storage → New bucket** → name `media` → **Public bucket: ON** (for image URLs).

### 2. Apply the schema

Get the connection string from **Settings → Database → Connection string → URI**.
Use the **Transaction pooler** (port `6543`) — required for Vercel serverless.

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dt"
# Expected tables: users, reports, sighting_details, media,
#                  hotspots, hotspot_reports, areas, interventions, cats
```

### 3. Register the daily hotspot refresh in pg_cron

```sql
SELECT cron.schedule(
  'daily-refresh-hotspots',
  '0 3 * * *',
  $$SELECT refresh_hotspots(30, 100.0, 1)$$
);
```

### 4. Grab the Supabase API keys

**Settings → API** → copy `URL` and the **service_role** key (`sb_secret_*` format) into `.env`.

### 5. Local development

```bash
# Install all workspace deps
npm install

# Backend (port 3001)
cd api
cp .env.example .env   # then fill in real values
npm run dev

# Frontend (port 5173, proxies /api to backend)
cd ../frontend
npm run dev
```

Health check:

```bash
curl http://localhost:3001/api/health
# {"status":"ok","timestamp":"..."}
```

### 6. Deploy to Vercel

```bash
npx vercel@latest login
npx vercel@latest link

# Set production env vars
npx vercel@latest env add DATABASE_URL production
npx vercel@latest env add SUPABASE_URL production
npx vercel@latest env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel@latest env add SUPABASE_BUCKET production

# Build frontend into api/public/ then deploy
cd frontend && npm run build && cd ..
npx vercel@latest --prod
```

Verify production:

```bash
curl https://<your-project>.vercel.app/api/health
```

## Frontend features

- **Citizen reporting tab** — Leaflet map picker (tap or GPS button), required fields
  validated client-side with clear error messages:
  - 問題内容 (multi-select): 糞尿 / 子猫 / 鳴き声 / 未手術猫 / 餌やり問題
  - 頭数 (radio): 1〜3 / 4〜10 / 10以上 / 不明
  - 耳カット (radio): 全てあり / 一部あり / なし / 不明
  - 子猫 (radio): いる / いない / 不明
  - 写真 (optional, auto-compressed before upload to stay under Vercel's 4.5MB limit)
  - メモ (free text, optional)
  - 関与意思 (radio): 情報提供のみ / 捕獲協力可能 / 継続的に関与可能
  - 費用負担 (radio + amount): 負担不可 / 一部可能 / 全額可能 + amount input
  - 要望 (multi-select): 被害を減らしたい / 手術したい / すぐ対応してほしい
  - 匿名で通報 (optional toggle)
- **Map view tab** — shows all reports as gray dots and hotspots as colored circles
  (sized by report count). Tap a report to see its data + photo. Tap a hotspot
  to open a detail panel (bottom-sheet on mobile, right sidebar on PC ≥768px)
  with aggregate stats and a photo gallery.
- **Color coding** — 🔴 kittens present, 🟡 no ear-cut visible, 🟢 managed.
- **Continuous reporting** — after submit, the user can immediately log a new
  report at a different location without going through the map view.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| POST | `/api/reports` | Submit a sighting (JSON, mock-spec fields) |
| GET | `/api/reports` | List reports (`?status=&limit=&offset=`) |
| POST | `/api/reports/:id/media` | Upload an image (multipart, field `image`) |
| PATCH | `/api/reports/:id/status` | Update report status |
| GET | `/api/hotspots` | List non-resolved hotspots |
| GET | `/api/hotspots/:id` | Hotspot detail + linked reports + media URLs |
| PATCH | `/api/hotspots/:id/status` | Update hotspot status |
| POST | `/api/hotspots/refresh` | Manually recluster (also runs nightly via pg_cron) |

### Example: submit a report

```bash
curl -X POST https://nicox.vercel.app/api/reports \
  -H 'Content-Type: application/json' \
  -d '{
    "longitude": 139.7670,
    "latitude": 35.6814,
    "problem_types": ["waste", "kittens"],
    "cat_count_range": "4-10",
    "ear_cut_status": "some",
    "kitten_status": "present",
    "involvement_level": "capture_help",
    "funding_level": "partial",
    "funding_amount": 10000,
    "requests": ["want_surgery", "immediate"],
    "notes": "Near the park entrance",
    "is_anonymous": true
  }'
```

## Hotspot lifecycle

1. A new report is saved to `reports` + `sighting_details`.
2. The API tries to link the report to the nearest active hotspot within 100m.
   If found, it updates the hotspot's aggregate stats (count, cat estimate,
   has_kitten, has_ear_cut_visible).
3. If no nearby hotspot exists, a new one is created at the report's location
   with status `high_priority` (when kittens are present) or `monitoring`.
4. Every day at 03:00 JST, Supabase's pg_cron runs `refresh_hotspots()` which
   re-clusters all recent pending reports using ST_ClusterDBSCAN
   (projected to Web Mercator so the 100m epsilon is in meters).

## Roadmap

- ✅ **Milestone 1** — DB foundation + API (completed)
- ✅ **Milestone 2** — Frontend (reporting form + map view with hotspots) (completed)
- **Milestone 3** — Authentication, staff dashboard (summary + table), interventions UI, individual cat tracking
