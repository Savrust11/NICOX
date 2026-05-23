# NICOX — Stray Cat Management System

A geospatial reporting & hotspot-detection platform for stray cat populations.
Citizens submit sightings with location + photo; the system clusters nearby
reports into "hotspots" (DBSCAN) so field staff can prioritize TNR interventions.

## Stack

| Layer | Tech |
|---|---|
| API | Node.js 18+, Express |
| Database | PostgreSQL 15+ with PostGIS 3+ ([Supabase](https://supabase.com)) |
| Image storage | [Supabase Storage](https://supabase.com) (same project) |
| Hosting | [Vercel](https://vercel.com) (serverless + daily cron) |

## Repository layout

```
api/         Node.js Express API (Vercel serverless entrypoint)
db/          PostgreSQL + PostGIS schema
frontend/    (reserved for Milestone 2)
vercel.json  Vercel build + cron configuration
```

## Milestone 1 — Setup

### 1. Create the Supabase project

1. Sign up at https://supabase.com and create a project (region: `Northeast Asia (Tokyo)` or closest).
2. **Database → Extensions** → enable `postgis`.
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

### 3. Grab the Supabase API keys

**Settings → API** → copy `URL` and `service_role` key into `.env`.

### 4. Local development

```bash
cd api
cp .env.example .env   # then fill in real values
npm install
npm run dev            # http://localhost:3001
```

Health check:

```bash
curl http://localhost:3001/api/health
# {"status":"ok","timestamp":"..."}
```

### 5. Deploy to Vercel

```bash
npm i -g vercel        # one time
vercel login
vercel link            # from repo root — accept defaults
# Set env vars (production):
vercel env add DATABASE_URL production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_BUCKET production
vercel --prod
```

Verify production:

```bash
curl https://<your-project>.vercel.app/api/health
```

The daily hotspot refresh cron (`0 3 * * *`) is registered automatically from
[vercel.json](vercel.json).

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| POST | `/api/reports` | Submit a sighting (JSON) |
| GET | `/api/reports` | List reports (`?status=&limit=&offset=`) |
| POST | `/api/reports/:id/media` | Upload an image (multipart, field `image`) |
| PATCH | `/api/reports/:id/status` | Update report status |
| GET | `/api/hotspots` | List active hotspots |
| GET | `/api/hotspots/:id` | Hotspot detail + reports |
| PATCH | `/api/hotspots/:id/status` | Update hotspot status |
| POST | `/api/hotspots/refresh` | Manually recluster (also runs nightly) |

### Example: submit a report

```bash
curl -X POST http://localhost:3001/api/reports \
  -H 'Content-Type: application/json' \
  -d '{
    "longitude": 139.7670,
    "latitude": 35.6814,
    "cat_count": 3,
    "has_kitten": true,
    "has_ear_cut": false,
    "notes": "Near the park entrance",
    "is_anonymous": true
  }'
```

## Roadmap

- **Milestone 1** — DB foundation + API (this milestone, due 2026-05-25)
- **Milestone 2** — Frontend (citizen reporting UI + staff dashboard map)
- **Milestone 3** — Authentication, interventions UI, individual cat tracking
