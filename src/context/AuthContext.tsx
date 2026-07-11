import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"

import { isSupabaseConfigured, supabase } from "../lib/supabase"
import type { Profile } from "../lib/platform"

type AuthValue = {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  async function loadProfile(userId: string) {
    if (!supabase) return
    const { data } = await supabase.from("profiles").select("id, full_name, plan").eq("id", userId).maybeSingle()
    setProfile((data as Profile | null) ?? { id: userId, full_name: null, plan: "free" })
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id)
  }

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) void loadProfile(data.session.user.id)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfile(null)
      if (nextSession?.user) void loadProfile(nextSession.user.id)
      setLoading(false)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthValue>(() => ({
    user: session?.user ?? null,
    session,
    profile,
    loading,
    configured: isSupabaseConfigured,
    refreshProfile,
    signOut: async () => { if (supabase) await supabase.auth.signOut() },
  }), [session, profile, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
