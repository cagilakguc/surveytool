import { useState } from "react"
import type { FormEvent } from "react"
import { Link, Navigate } from "react-router-dom"
import { ArrowLeft, LockKeyhole, Mail, UserPlus } from "lucide-react"

import PageSeo from "../components/PageSeo"
import { useAuth } from "../context/AuthContext"
import { supabase } from "../lib/supabase"

export default function Auth() {
  const { user, configured } = useAuth()
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/dashboard" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) { setMessage("Account connection is being configured."); return }
    setBusy(true); setMessage("")
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/dashboard` } })
    setMessage(result.error ? result.error.message : mode === "signup" ? "Check your email to confirm your account." : "Signed in successfully.")
    setBusy(false)
  }

  return <div className="relative z-10 min-h-screen px-6 py-20"><PageSeo title="Sign in | SurveyTool.io" description="Sign in to save SurveyTool projects, files and analysis results." canonicalUrl="https://www.surveytool.io/auth" /><div className="mx-auto max-w-md"><Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-cyan-300"><ArrowLeft size={18} /> Back to home</Link><div className="mt-12 rounded-3xl border border-white/10 bg-white/5 p-7 shadow-2xl shadow-cyan-950/20"><div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-300 w-fit">{mode === "signin" ? <LockKeyhole /> : <UserPlus />}</div><h1 className="mt-5 text-3xl font-bold">{mode === "signin" ? "Welcome back" : "Create your account"}</h1><p className="mt-2 text-slate-400">Save projects, files and previous survey results.</p>{!configured && <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-200">Account connection is ready in code and awaiting Supabase environment keys.</div>}<form className="mt-7 space-y-5" onSubmit={(event) => void submit(event)}><label className="block text-sm font-medium text-slate-300">Email<div className="relative mt-2"><Mail size={18} className="absolute left-4 top-3.5 text-slate-500" /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 py-3 pl-11 pr-4 outline-none focus:border-cyan-400" /></div></label><label className="block text-sm font-medium text-slate-300">Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400" /></label>{message && <p role="status" className="text-sm text-cyan-200">{message}</p>}<button disabled={busy || !configured} className="w-full rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button></form><button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage("") }} className="mt-6 w-full text-sm text-slate-400 hover:text-white">{mode === "signin" ? "New to SurveyTool? Create an account" : "Already have an account? Sign in"}</button></div></div></div>
}
