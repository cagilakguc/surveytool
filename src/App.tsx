import Navbar from "./components/Navbar"
import Hero from "./components/Hero"
import Features from "./components/Features"

function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-cyan-400/20 blur-[140px]" />
        <div className="absolute right-0 top-1/3 h-[350px] w-[350px] rounded-full bg-blue-500/10 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      </div>

      <Navbar />
      <Hero />
      <Features />
    </main>
  )
}

export default App