import { Link } from "react-router-dom"

import LogoMark from "./LogoMark"

export default function Navbar() {
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
          className="hidden items-center gap-8 text-sm text-slate-300 md:flex"
        >
          <a className="transition hover:text-white" href="#tools">
            Tools
          </a>
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

        <Link
          to="/tools/csv-to-dxf"
          className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:scale-105 hover:bg-cyan-300 sm:px-6"
        >
          Get Started
        </Link>
      </div>
    </header>
  )
}
