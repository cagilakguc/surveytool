import { Link } from "react-router-dom"

import LogoMark from "./LogoMark"

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative z-10 border-t border-white/10 bg-slate-950/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 md:grid-cols-[1fr_auto] md:items-end lg:px-8">
        <div>
          <Link
            to="/"
            aria-label="SurveyTool home"
            className="inline-flex items-center gap-3"
          >
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-bold">SurveyTool.io</span>
          </Link>

          <p className="mt-4 max-w-md leading-7 text-slate-400">
            Practical browser-based tools built for surveyors.
            Your project files are processed locally in your browser.
          </p>
        </div>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap gap-x-7 gap-y-3 text-sm text-slate-400"
        >
          <Link className="transition hover:text-white" to="/">
            Home
          </Link>
          <Link
            className="transition hover:text-white"
            to="/tools/csv-to-dxf"
          >
            CSV to DXF
          </Link>
          <Link
            className="transition hover:text-white"
            to="/tools/landxml-viewer"
          >
            LandXML Viewer
          </Link>
        </nav>

        <div className="border-t border-white/10 pt-6 text-sm text-slate-500 md:col-span-2">
          © {year} SurveyTool.io. Built for modern survey workflows.
        </div>
      </div>
    </footer>
  )
}
