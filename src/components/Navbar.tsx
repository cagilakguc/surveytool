export default function Navbar() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-[#050816]/70 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-8">

        <div className="flex items-center gap-3">

          <div className="h-10 w-10 rounded-xl bg-cyan-400"></div>

          <div>
            <div className="text-lg font-bold">
              SurveyTool
            </div>

            <div className="text-xs text-slate-400">
              surveytool.io
            </div>
          </div>

        </div>

        <nav className="hidden gap-10 text-sm text-slate-300 md:flex">
          <a href="#">Features</a>
          <a href="#">Tools</a>
          <a href="#">Pricing</a>
          <a href="#">Documentation</a>
        </nav>

        <button className="rounded-full bg-cyan-400 px-6 py-2 font-semibold text-slate-900 transition hover:scale-105">
          Get Started
        </button>

      </div>
    </header>
  )
}