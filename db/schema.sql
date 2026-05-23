-- ============================================================================
-- Stray Cat Management System - MVP Database Schema
-- PostgreSQL 13+ with PostGIS 3.0+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- LAYER 0: Foundation
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(50) NOT NULL DEFAULT 'citizen',
  area_id INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================================
-- LAYER 1: Raw Data Layer (Immutable Event Log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  location GEOGRAPHY(Point, 4326) NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(50) NOT NULL DEFAULT 'web',
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  is_anonymous BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_location ON reports USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_reports_reported_at ON reports(reported_at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);

CREATE TABLE IF NOT EXISTS sighting_details (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  cat_count INTEGER,
  has_ear_cut BOOLEAN,
  has_kitten BOOLEAN,
  behavior VARCHAR(255),
  behavior_notes TEXT,
  additional_info JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sighting_report_id ON sighting_details(report_id);

CREATE TABLE IF NOT EXISTS media (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  url VARCHAR(1024) NOT NULL,
  file_path VARCHAR(512),
  taken_at TIMESTAMPTZ,
  file_size INTEGER,
  media_type VARCHAR(50) DEFAULT 'image/jpeg',
  ai_tags JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_report_id ON media(report_id);

-- ============================================================================
-- LAYER 2: Aggregation Layer
-- ============================================================================

CREATE TABLE IF NOT EXISTS hotspots (
  id BIGSERIAL PRIMARY KEY,
  centroid GEOGRAPHY(Point, 4326) NOT NULL,
  radius_meters FLOAT DEFAULT 100.0,
  report_count INTEGER DEFAULT 0,
  latest_report_id BIGINT REFERENCES reports(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  cat_count_estimate INTEGER,
  has_kitten BOOLEAN DEFAULT FALSE,
  has_ear_cut_visible BOOLEAN DEFAULT FALSE,
  computed_priority_score FLOAT,
  status VARCHAR(50) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hotspots_centroid ON hotspots USING GIST(centroid);
CREATE INDEX IF NOT EXISTS idx_hotspots_last_seen_at ON hotspots(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_hotspots_status ON hotspots(status);

CREATE TABLE IF NOT EXISTS hotspot_reports (
  hotspot_id BIGINT NOT NULL REFERENCES hotspots(id) ON DELETE CASCADE,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  PRIMARY KEY(hotspot_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_hotspot_reports_report_id ON hotspot_reports(report_id);

CREATE TABLE IF NOT EXISTS areas (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  geometry GEOMETRY(Polygon, 4326) NOT NULL,
  parent_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  area_type VARCHAR(50) NOT NULL,
  description TEXT,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_areas_geometry ON areas USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_areas_parent_id ON areas(parent_id);
CREATE INDEX IF NOT EXISTS idx_areas_area_type ON areas(area_type);

-- ============================================================================
-- LAYER 3: Operational Layer
-- ============================================================================

CREATE TABLE IF NOT EXISTS interventions (
  id BIGSERIAL PRIMARY KEY,
  hotspot_id BIGINT NOT NULL REFERENCES hotspots(id) ON DELETE CASCADE,
  intervention_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'planned',
  scheduled_at TIMESTAMPTZ,
  performed_at TIMESTAMPTZ,
  performed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome VARCHAR(255),
  cats_involved INTEGER,
  notes TEXT,
  cost NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interventions_hotspot_id ON interventions(hotspot_id);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);

CREATE TABLE IF NOT EXISTS cats (
  id BIGSERIAL PRIMARY KEY,
  hotspot_id BIGINT REFERENCES hotspots(id) ON DELETE SET NULL,
  identifier VARCHAR(255),
  ear_cut_date DATE,
  surgery_intervention_id BIGINT REFERENCES interventions(id) ON DELETE SET NULL,
  photo_urls TEXT[],
  status VARCHAR(50) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cats_hotspot_id ON cats(hotspot_id);

-- ============================================================================
-- FUNCTION: refresh_hotspots (daily batch)
-- Uses DBSCAN for density-based clustering (no need to specify k upfront)
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_hotspots(
  days_back INTEGER DEFAULT 30,
  cluster_eps_meters FLOAT DEFAULT 100.0,
  min_points INTEGER DEFAULT 1
) RETURNS TABLE(hotspot_count INTEGER) AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH recent_reports AS (
    SELECT
      id,
      location,
      reported_at
    FROM reports
    WHERE status = 'pending'
      AND reported_at >= CURRENT_TIMESTAMP - (days_back || ' days')::INTERVAL
  ),
  clustered AS (
    SELECT
      -- ST_ClusterDBSCAN only accepts geometry; project to Web Mercator (SRID 3857) so eps is in meters.
      ST_ClusterDBSCAN(ST_Transform(location::geometry, 3857), cluster_eps_meters, min_points) OVER () AS cluster_id,
      id,
      location,
      reported_at
    FROM recent_reports
  ),
  cluster_stats AS (
    SELECT
      cluster_id,
      ST_Centroid(ST_Collect(location::geometry))::geography AS centroid,
      COUNT(*)::INTEGER AS report_count,
      MIN(reported_at) AS first_seen_at,
      MAX(reported_at) AS last_seen_at,
      ARRAY_AGG(id) AS report_ids
    FROM clustered
    WHERE cluster_id IS NOT NULL
    GROUP BY cluster_id
  ),
  inserted AS (
    INSERT INTO hotspots (
      centroid,
      radius_meters,
      report_count,
      first_seen_at,
      last_seen_at,
      cat_count_estimate,
      has_kitten,
      has_ear_cut_visible,
      status,
      created_at,
      updated_at
    )
    SELECT
      cs.centroid,
      cluster_eps_meters,
      cs.report_count,
      cs.first_seen_at,
      cs.last_seen_at,
      (
        SELECT COALESCE(SUM(sd.cat_count), cs.report_count)
        FROM sighting_details sd
        WHERE sd.report_id = ANY(cs.report_ids)
      ),
      (
        SELECT BOOL_OR(sd.has_kitten)
        FROM sighting_details sd
        WHERE sd.report_id = ANY(cs.report_ids)
      ),
      (
        SELECT BOOL_OR(sd.has_ear_cut)
        FROM sighting_details sd
        WHERE sd.report_id = ANY(cs.report_ids)
      ),
      'active',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM cluster_stats cs
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM inserted;

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW v_hotspots_summary AS
SELECT
  h.id,
  ST_X(h.centroid::geometry) AS longitude,
  ST_Y(h.centroid::geometry) AS latitude,
  h.status,
  h.report_count,
  h.cat_count_estimate,
  h.has_kitten,
  h.has_ear_cut_visible,
  h.computed_priority_score,
  h.first_seen_at,
  h.last_seen_at,
  COUNT(DISTINCT i.id) AS intervention_count,
  MAX(i.performed_at) AS last_intervention_at,
  (SELECT a.name FROM areas a WHERE ST_Contains(a.geometry, h.centroid::geometry) LIMIT 1) AS area_name
FROM hotspots h
LEFT JOIN interventions i ON h.id = i.hotspot_id AND i.status = 'completed'
GROUP BY h.id;
