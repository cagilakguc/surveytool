import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, CheckCircle2, ExternalLink, Lightbulb, MessageCircle, ThumbsDown, ThumbsUp } from "lucide-react"
import { Link } from "react-router-dom"
import Navbar from "../components/Navbar"
import Footer from "../components/Footer"
import PageSeo from "../components/PageSeo"
import { feedbackIssueUrl, feedbackTopics, parseFeedback } from "../lib/feedback"
import type { FeedbackTone } from "../lib/feedback"

const guides = [
  { title: "CSV / TXT to DXF", to: "/tools/csv-to-dxf", text: "Choose your file, map the point ID, easting and northing columns, then preview the rows. Height and code are optional. Choose your labels and download the DXF." },
  { title: "Opening a DXF in Civil 3D", to: "/tools/csv-to-dxf", text: "Use OPEN and choose the DXF file type. Run ZOOM, then Extents to see the points. The export contains ordinary CAD points and text labels; Civil 3D COGO points need a separate conversion." },
  { title: "GIS Export", to: "/tools/gis-export", text: "Choose a CSV, TXT or ASCII DXF file. Search global coordinate systems by EPSG code, grid name or country, then select the actual input CRS and desired output CRS. Inspect points, lines and polygons over street or aerial maps, then download a Shapefile ZIP or GeoPackage. X/Y are reprojected; Z values, height units and the vertical datum are retained. Use input CRS for output to preserve coordinates. Required but unavailable datum grids are reported." },
  { title: "LandXML and surfaces", to: "/tools/landxml-viewer", text: "Open your LandXML and choose the layers you want to inspect. If data is missing, check that the exported file includes the surface points and triangles. Use Surface Compare or Cross Section for further checks." },
]

export default function Help() {
  const [tone, setTone] = useState<FeedbackTone>("positive")
  const [topic, setTopic] = useState("General")
  const [message, setMessage] = useState("")
  const [email, setEmail] = useState("")
  const [delivery, setDelivery] = useState<"checking" | "private" | "github">("checking")
  const [busy, setBusy] = useState(false)
  const [received, setReceived] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    let active = true
    fetch("/api/feedback", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setDelivery(data?.available === true ? "private" : "github") })
      .catch(() => { if (active) setDelivery("github") })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [])

  const publicUrl = feedbackIssueUrl({ tone, topic, message })

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    if (delivery !== "private") { setError("Use the GitHub button below to review your feedback."); return }
    let feedback
    try { feedback = parseFeedback({ tone, topic, message, email }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Please check your feedback."); return }
    setBusy(true)
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feedback), signal: AbortSignal.timeout(15000) })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.received !== true) throw new Error(data?.error || "Your feedback could not be sent. Please try again.")
      setReceived(true)
      setMessage("")
      setEmail("")
    } catch (caught) {
      setError(caught instanceof Error && caught.name !== "TimeoutError" ? caught.message : "Sending took too long. Please try again.")
    } finally { setBusy(false) }
  }

  return (
    <>
      <PageSeo title="Help & Feedback | SurveyTool.io" description="Quick help for SurveyTool's surveying tools. Share positive feedback, report a problem or suggest an improvement." canonicalUrl="https://www.surveytool.io/help" />
      <Navbar />
      <div className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-32 lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">We’re listening</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Help & Feedback</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-400">Something worked well? Something could be better? Tell us what you think, or find a quick answer below.</p>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <section className="h-fit rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-8" aria-labelledby="feedback-heading">
            <h2 id="feedback-heading" className="flex items-center gap-3 text-2xl font-semibold"><MessageCircle className="text-cyan-300" /> Share your feedback</h2>
            {received ? (
              <div role="status" className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-6">
                <CheckCircle2 className="text-emerald-300" />
                <h3 className="mt-3 text-xl font-semibold">Thank you — we received it.</h3>
                <p className="mt-2 text-slate-400">Your feedback helps improve SurveyTool.</p>
                <button type="button" onClick={() => setReceived(false)} className="mt-5 font-semibold text-cyan-200 hover:text-cyan-100">Leave more feedback</button>
              </div>
            ) : (
              <form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)}>
                <fieldset disabled={busy}>
                  <legend className="mb-3 text-sm font-medium text-slate-300">What would you like to share?</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: "positive", label: "Positive", icon: ThumbsUp },
                      { value: "negative", label: "An issue", icon: ThumbsDown },
                      { value: "idea", label: "Question / idea", icon: Lightbulb },
                    ] as const).map((option) => (
                      <label key={option.value} className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-2 py-4 text-center text-xs font-semibold focus-within:ring-2 focus-within:ring-cyan-300 sm:text-sm ${tone === option.value ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-400 hover:bg-white/5"}`}>
                        <input type="radio" name="tone" value={option.value} checked={tone === option.value} onChange={() => setTone(option.value)} className="sr-only" />
                        <option.icon size={20} />{option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block text-sm text-slate-300">Which tool?
                  <select value={topic} disabled={busy} onChange={(event) => setTopic(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white outline-none focus:border-cyan-300">
                    {feedbackTopics.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">Your feedback
                  <textarea value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} required minLength={5} maxLength={2000} rows={6} placeholder="What worked, what went wrong, or what would you like us to add?" className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300" />
                  <span className="mt-1 block text-right text-xs text-slate-500">{message.length} / 2,000</span>
                </label>
                {delivery === "private" && <label className="block text-sm text-slate-300">Email for a reply <span className="text-slate-500">(optional)</span><input type="email" autoComplete="email" value={email} disabled={busy} maxLength={254} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300" /></label>}
                {error && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/5 p-3 text-sm text-rose-200">{error}</p>}
                {delivery === "checking" ? <p role="status" className="text-sm text-slate-400">Checking feedback availability…</p> : delivery === "private" ? (
                  <>
                    <p className="text-xs leading-5 text-slate-500">Feedback is sent privately to SurveyTool. No account is needed. Please describe the problem without attaching project files.</p>
                    <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50">{busy ? "Sending…" : "Send feedback"}<ArrowRight size={17} /></button>
                    {error && <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-cyan-200">Review as a public GitHub issue <ExternalLink size={14} /></a>}
                  </>
                ) : (
                  <>
                    <p className="rounded-xl border border-white/10 bg-slate-950/50 p-4 text-sm leading-6 text-slate-400">Feedback currently opens on <strong className="text-slate-200">GitHub</strong>, where you can review it before posting. A GitHub account is needed and posts are public. Keep private project details out of your message.</p>
                    {message.trim().length >= 5 ? <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Review feedback on GitHub <ExternalLink size={16} /></a> : <button disabled type="button" className="w-full rounded-full bg-cyan-400/40 px-5 py-3 font-semibold text-slate-950">Add your feedback to continue</button>}
                  </>
                )}
              </form>
            )}
          </section>

          <section aria-labelledby="help-heading">
            <h2 id="help-heading" className="mb-5 text-2xl font-semibold">Quick help</h2>
            <div className="space-y-4">
              {guides.map((guide) => <details key={guide.title} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5"><summary className="cursor-pointer font-semibold text-slate-100">{guide.title}</summary><p className="mt-4 text-sm leading-7 text-slate-400">{guide.text}</p><Link to={guide.to} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200">Open tool <ArrowRight size={15} /></Link></details>)}
              <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><summary className="cursor-pointer font-semibold text-slate-100">What should I include when reporting a problem?</summary><p className="mt-4 text-sm leading-7 text-slate-400">Tell us which tool you used, the file format, what you expected and what happened. Include the error text if there is one. This usually gives us enough to start checking the issue.</p></details>
            </div>
          </section>
        </div>
      </div>
      <Footer />
    </>
  )
}
