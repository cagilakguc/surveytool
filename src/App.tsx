import "./index.css";

const tools = [
  {
    title: "CSV → DXF",
    description: "Convert survey point files into clean DXF drawings.",
    status: "Ready",
  },
  {
    title: "LandXML Viewer",
    description: "View alignments, surfaces, and design data online.",
    status: "Coming soon",
  },
  {
    title: "Surface Comparison",
    description: "Compare as-built and design surfaces.",
    status: "Coming soon",
  },
  {
    title: "Cross Sections",
    description: "Create quick sections from imported survey data.",
    status: "Coming soon",
  },
];

function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold">SurveyTool</h1>
            <p className="text-sm text-slate-400">
              Professional surveying utilities for the web
            </p>
          </div>

          <button className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
            Launch CSV → DXF
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-cyan-400">
          SurveyTool.io
        </p>

        <h2 className="max-w-3xl text-5xl font-bold tracking-tight">
          Fast browser-based tools for surveyors.
        </h2>

        <p className="mt-6 max-w-3xl text-lg text-slate-300">
          Convert point files, inspect survey data, create DXF outputs, and
          build practical site-ready utilities without opening heavy CAD
          software.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {tools.map((tool) => (
            <div
              key={tool.title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-xl"
            >
              <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300">
                {tool.status}
              </span>

              <h3 className="mt-5 text-xl font-semibold">{tool.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {tool.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;