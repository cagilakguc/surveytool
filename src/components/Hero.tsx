export default function Hero() {
  return (
    <section className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col items-center justify-center px-6 pt-20 text-center">
      <div className="mb-6 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
        SurveyTool.io · Online tools for modern surveyors
      </div>

      <h1 className="max-w-5xl text-5xl font-bold tracking-tight md:text-7xl">
        Surveying tools that work straight from your browser.
      </h1>

      <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
        Create DXFs, inspect LandXML files, compare surfaces,
        calculate volumes and generate reports without installing
        heavy software.
      </p>

      <div className="mt-10 flex flex-col gap-4 sm:flex-row">
        <button className="rounded-full bg-cyan-400 px-8 py-3 font-semibold text-slate-900 transition hover:scale-105">
          Start with CSV to DXF
        </button>

        <button className="rounded-full border border-white/15 px-8 py-3 font-semibold transition hover:bg-white/10">
          View Tools
        </button>
      </div>
    </section>
  );
}