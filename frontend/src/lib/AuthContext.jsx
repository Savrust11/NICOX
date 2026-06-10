import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  refreshUser: async () => {},
})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null) // our DB user (role / approval_status)
  const [loading, setLoading] = useState(true)

  const fetchMe = useCallback(async (currentSession) => {
    const headers = currentSession
      ? { Authorization: `Bearer ${currentSession.access_token}` }
      : {}
    try {
      const res = await fetch('/api/auth/me', { headers, cache: 'no-store' })
      const data = await res.json()
      setUser(data.user)
    } catch (err) {
      console.error('fetchMe failed:', err)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await fetchMe(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      await fetchMe(newSession)
    })
    return () => sub.subscription.unsubscribe()
  }, [fetchMe])

  const signIn = useCallback(async (email, password) => {
    if (!supabase) throw new Error('Supabase client not initialized')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }, [])

  const signUp = useCallback(async (email, password, metadata = {}) => {
    if (!supabase) throw new Error('Supabase client not initialized')
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        // Use the current site's origin so the confirmation link comes back to production
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) throw error
    return data
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
  }, [])

  const refreshUser = useCallback(() => fetchMe(session), [fetchMe, session])

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
