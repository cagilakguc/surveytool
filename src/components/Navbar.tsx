import { Link } from "react-router-dom"
import { useEffect, useState } from "react"

import LogoMark from "./LogoMark"

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function Navbar() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled) }
  }, [])
  async function installApp() {
    if (!installPrompt) return
    try { await installPrompt.prompt(); await installPrompt.userChoice }
    finally { setInstallPrompt(null) }
  }

  return (
    <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-[#050816]/70 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Link
          to="/"
          aria-label="SurveyTool home"
          className="flex items-center gap-3"
        >
          <LogoMark />

          <div>
            <div className="text-lg font-bold">
              SurveyTool
            </div>

            <div className="text-xs text-slate-400">
              surveytool.io
            </div>
          </div>
        </Link>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-5 text-sm text-slate-300 lg:flex"
        >
          <a className="transition hover:text-white" href="#tools">
            Tools
          </a>
          <Link
            className="transition hover:text-white"
            to="/tools/csv-to-dxf"
          >
            CSV / TXT to DXF
          </Link>
          <Link
            className="transition hover:text-white"
            to="/tools/landxml-viewer"
          >
            LandXML Viewer
          </Link>
          <Link className="transition hover:text-white" to="/tools/contours-to-terrain">3D Terrain</Link>
          <Link className="transition hover:text-white" to="/projects">Projects</Link>
          <Link className="transition hover:text-white" to="/help">Help & Feedback</Link>
        </nav>

        <div className="flex items-center gap-2">
        {installPrompt && <button type="button" onClick={() => void installApp()} className="rounded-full border border-cyan-300/50 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-300/10">Install App</button>}
        <Link
          to="/dashboard"
          className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:scale-105 hover:bg-cyan-300 sm:px-6"
        >
          Dashboard
        </Link>
        </div>
      </div>
    </header>
  )
}
