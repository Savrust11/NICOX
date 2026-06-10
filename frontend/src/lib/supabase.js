import { createClient } from '@supabase/supabase-js'

// These need to come from Vite env vars (publishable / anon key — safe to expose in browser)
const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = url && anon ? createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
}) : null

export function authHeader(session) {
  if (!session) return {}
  return { Authorization: `Bearer ${session.access_token}` }
}
