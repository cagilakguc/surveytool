import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { FolderPlus, LogOut, Upload, Zap } from "lucide-react"
import { Link, Navigate } from "react-router-dom"

import { useAuth } from "../context/AuthContext"
import { planLimits, type Project } from "../lib/platform"
import { supabase } from "../lib/supabase"

export default function Dashboard() {
  const { configured, loading, profile, signOut, user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || !supabase) return
    supabase.from("projects").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setProjects((data ?? []) as Project[]))
  }, [user])

  if (loading) return <div className="relative flex min-h-screen items-center justify-center text-cyan-300">Loading workspace…</div>
  if (!configured) return <SetupPreview />
  if (!user) return <Navigate to="/auth" replace />

  const plan = profile?.plan ?? "free"
  const limits = planLimits[plan]

  async function createProject(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !user || !name.trim()) return
    if (projects.length >= limits.maximumProjects) return setMessage("Free plan allows one saved project. Upgrade to Pro for unlimited projects.")
    setBusy(true)
    const { data, error } = await supabase.from("projects").insert({ name: name.trim(), owner_id: user.id }).select().single()
    setBusy(false)
    if (error) return setMessage(error.message)
    setProjects((current) => [data as Project, ...current])
    setName("")
    setMessage("Project created.")
  }

  async function uploadFile(project: Project, file?: File) {
    if (!file || !supabase || !user) return
    if (file.size > limits.maximumFileSize) return setMessage(`Your ${plan} plan supports files up to ${limits.maximumFileSize / 1024 / 1024} MB.`)
    setBusy(true)
    const path = `${user.id}/${project.id}/${crypto.randomUUID()}-${file.name}`
    const uploaded = await supabase.storage.from("project-files").upload(path, file)
    if (!uploaded.error) await supabase.from("project_files").insert({ owner_id: user.id, project_id: project.id, name: file.name, storage_path: path, size_bytes: file.size, mime_type: file.type })
    setBusy(false)
    setMessage(uploaded.error ? uploaded.error.message : `${file.name} saved to ${project.name}.`)
  }

  async function billing(endpoint: "create-checkout" | "customer-portal") {
    if (!supabase) return
    setBusy(true)
    const { data } = await supabase.auth.getSession()
    const response = await fetch(`/api/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token}` } })
    const body = await response.json()
    setBusy(false)
    if (body.url) window.location.assign(body.url)
    else setMessage(body.error ?? "Billing could not be opened.")
  }

  return (
    <div className="relative mx-auto min-h-screen max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div><Link to="/" className="text-cyan-300">← SurveyTool</Link><h1 className="mt-3 text-4xl font-bold">Your workspace</h1><p className="mt-2 text-slate-400">Projects, survey files and analysis results in one place.</p></div>
        <button onClick={() => void signOut()} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-slate-300 hover:bg-white/5"><LogOut size={16}/> Sign out</button>
      </header>

      <section className="mb-8 grid gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-6">
          <div className="flex items-center justify-between"><span className="text-slate-400">Current plan</span><span className="rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold uppercase text-slate-950">{plan}</span></div>
          <p className="mt-5 text-2xl font-semibold">{limits.maximumFileSize / 1024 / 1024} MB per file</p><p className="mt-1 text-sm text-slate-400">{plan === "pro" ? "Unlimited saved projects, reports and Surface Compare." : "One saved project and basic conversions."}</p>
          <button disabled={busy} onClick={() => void billing(plan === "pro" ? "customer-portal" : "create-checkout")} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"><Zap size={17}/>{plan === "pro" ? "Manage billing" : "Upgrade to Pro"}</button>
        </div>
        <form onSubmit={(event) => void createProject(event)} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><FolderPlus className="text-cyan-300"/> New project</h2><p className="mt-2 text-sm text-slate-400">Group LandXML, CSV/TXT files and future comparison results.</p>
          <div className="mt-6 flex gap-3"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 outline-none focus:border-cyan-400"/><button disabled={busy} className="rounded-xl bg-white px-5 font-semibold text-slate-950 disabled:opacity-50">Create</button></div>
        </form>
      </section>

      {message && <p className="mb-6 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-sm text-cyan-100">{message}</p>}
      <section><h2 className="mb-4 text-2xl font-semibold">Projects</h2>{projects.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center text-slate-400">Create your first project to save files and results.</div> : <div className="grid gap-4 md:grid-cols-2">{projects.map((project) => <article key={project.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"><h3 className="text-lg font-semibold">{project.name}</h3><p className="mt-1 text-xs text-slate-500">Created {new Date(project.created_at).toLocaleDateString()}</p><label className="mt-6 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm hover:bg-white/5"><Upload size={16}/> Upload survey file<input type="file" className="hidden" accept=".xml,.csv,.txt,.dxf" onChange={(event) => void uploadFile(project, event.target.files?.[0])}/></label></article>)}</div>}</section>
    </div>
  )
}

function SetupPreview() {
  return <div className="relative mx-auto flex min-h-screen max-w-3xl items-center px-6"><div className="w-full rounded-3xl border border-cyan-400/20 bg-slate-900/80 p-10 text-center"><span className="rounded-full bg-amber-400/10 px-4 py-2 text-sm text-amber-300">Connection required</span><h1 className="mt-6 text-4xl font-bold">Dashboard is ready</h1><p className="mx-auto mt-4 max-w-xl text-slate-400">Add the Supabase URL and publishable key to the deployment environment to activate sign-in, projects and secure file storage.</p><Link to="/" className="mt-8 inline-block rounded-xl border border-white/10 px-5 py-3">Return home</Link></div></div>
}
