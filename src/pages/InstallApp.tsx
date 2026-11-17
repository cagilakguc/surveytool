import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, CheckCircle2, Download, ExternalLink, Globe, MonitorSmartphone, Share2, Smartphone } from "lucide-react"
import Navbar from "../components/Navbar"
import Footer from "../components/Footer"
import PageSeo from "../components/PageSeo"

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

const siteUrl = "https://www.surveytool.io/app"

export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalled(displayMode)
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPrompt)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
      setNotice("SurveyTool is installed. Open it from your home screen or app list.")
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  async function install() {
    if (!prompt || busy) return
    setBusy(true)
    try {
      await prompt.prompt()
      const selection = await prompt.userChoice
      if (selection.outcome === "accepted") setNotice("Install requested. Check your device's home screen or app list.")
      else setNotice("You can install later from your browser menu.")
      setPrompt(null)
    } catch {
      setNotice("Use your browser menu to install the app instead.")
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "SurveyTool — Surveying Tools", text: "Install SurveyTool on your phone, tablet or computer.", url: siteUrl })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(siteUrl)
        setNotice("App link copied to clipboard.")
      } else {
        setNotice("Share this link: " + siteUrl)
      }
    } catch {
      // Cancelling a native share is not an error.
    }
  }

  return (
    <div className="relative z-10 min-h-screen">
      <PageSeo
        title="Install SurveyTool App | Surveying Tools on Android, iPhone & Desktop"
        description="Install SurveyTool as an app on Android, iPhone, iPad or desktop. Work with DXF, LandXML, as-built checks and survey calculations from your home screen."
        canonicalUrl={siteUrl}
      />
      <Navbar />
      <div className="mx-auto max-w-5xl px-6 pb-24 pt-36">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-300"><ArrowLeft size={17} /> Back to SurveyTool</Link>
        <div className="mt-12 grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">SurveyTool mobile & desktop app</p>
            <h1 className="mt-5 text-5xl font-bold tracking-tight sm:text-6xl">Survey tools, wherever you work.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Add SurveyTool to your home screen and open the same surveying tools you use on site or in the office — without searching for the website every time.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {installed ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-6 py-3 font-semibold text-emerald-200"><CheckCircle2 size={20}/> Already installed on this device</span>
              ) : prompt ? (
                <button type="button" disabled={busy} onClick={() => void install()} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"><Download size={19}/>{busy ? "Opening install…" : "Install SurveyTool"}</button>
              ) : (
                <a href="#install-instructions" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"><Download size={19}/> How to install</a>
              )}
              <button type="button" onClick={() => void share()} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/20 px-6 py-3 font-semibold text-white hover:bg-white/10"><Share2 size={18}/> Share app</button>
            </div>
            {notice && <p role="status" className="mt-4 text-sm text-cyan-200">{notice}</p>}
            <p className="mt-5 text-sm text-slate-400">Free to install. No separate download required. New tools and fixes update from the website.</p>
          </div>
          <div className="rounded-[2rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 via-slate-900 to-blue-500/10 p-8 shadow-2xl shadow-cyan-900/10">
            <div className="mx-auto max-w-[245px] rounded-[2.2rem] border-8 border-slate-700 bg-slate-950 px-5 py-8 shadow-xl">
              <div className="mx-auto mb-8 h-2 w-20 rounded-full bg-slate-700" />
              <img src="/icons/icon-192.png" alt="SurveyTool app icon" className="mx-auto h-24 w-24 rounded-2xl"/>
              <p className="mt-5 text-center text-xl font-bold">SurveyTool</p>
              <p className="mt-2 text-center text-sm text-slate-400">DXF · LandXML · Setout</p>
              <div className="mt-8 space-y-2">
                {["DXF Hatch & Road Markings", "Surface Compare", "Pavement Conformance"].map((label) => (
                  <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-center text-xs text-slate-300">{label}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <section id="install-instructions" className="mt-24 scroll-mt-24">
          <h2 className="text-3xl font-bold">Install on your device</h2>
          <p className="mt-3 max-w-2xl text-slate-400">Choose your device and follow its browser's installation menu. No store account is needed for the installable web app.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <Smartphone className="text-cyan-300" size={27}/>
              <h3 className="mt-4 text-xl font-semibold">Android & Trimble TSC5</h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">Open <strong>surveytool.io</strong> in Chrome. Tap the three-dot menu, then <strong>Install app</strong> or <strong>Add to Home screen</strong>. Open SurveyTool from your app list.</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <Smartphone className="text-cyan-300" size={27}/>
              <h3 className="mt-4 text-xl font-semibold">iPhone & iPad</h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">Open <strong>surveytool.io</strong> in Safari. Tap <strong>Share</strong>, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>. The app will appear on your home screen.</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <MonitorSmartphone className="text-cyan-300" size={27}/>
              <h3 className="mt-4 text-xl font-semibold">Windows & desktop</h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">Open the site in Chrome or Edge, then select <strong>Install SurveyTool</strong> from the browser's app-install icon or menu.</p>
            </article>
          </div>
        </section>
        <div className="mt-12 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Globe size={20} className="text-amber-200"/> Working offline</h2>
          <p className="mt-2 text-sm leading-7 text-slate-300">Open the app while online first so its app shell can be saved. Some local calculations and saved projects work offline, but background maps, cloud sign-in, cloud storage and external services require internet. Keep a separate backup of critical survey files.</p>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Link to="/tools/dxf-hatch-converter" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-slate-950 hover:bg-slate-200">Try Hatch Converter <ExternalLink size={17}/></Link>
          <Link to="/help" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 font-semibold hover:bg-white/10">Help & Feedback</Link>
        </div>
      </div>
      <Footer />
    </div>
  )
}
