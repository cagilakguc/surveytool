import Navbar from "../components/Navbar"
import Hero from "../components/Hero"
import Features from "../components/Features"
import Footer from "../components/Footer"

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20" aria-labelledby="custom-tools-heading">
        <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/5 px-6 py-10 sm:px-10">
          <h2 id="custom-tools-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
            Custom surveying tools for your workflow
          </h2>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
            Still building as-built reports by hand or converting the same files every week? We build browser-based
            tools for independent surveyors and company teams, from custom file converters to pavement conformance
            reports that match your company’s template.
          </p>
          <a href="/custom-tools" className="mt-6 inline-flex rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300">
            Discuss your workflow
          </a>
        </div>
      </section>
      <Footer />
    </>
  )
}
