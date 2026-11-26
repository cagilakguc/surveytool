import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import Footer from "../components/Footer"
import Navbar from "../components/Navbar"
import PageSeo from "../components/PageSeo"
import { customEnquiryTopic, parseFeedback } from "../lib/feedback"

const questions = [
  { name: "workflow", label: "How do you do this today?", placeholder: "For example, we check pavement levels in Excel and assemble a PDF by hand." },
  { name: "inputs", label: "What files do you start with?", placeholder: "For example, CSV survey points and a LandXML design surface." },
  { name: "output", label: "What output do you need?", placeholder: "For example, a PDF using our company’s conformance report template." },
] as const

const fieldClass = "mt-2 w-full rounded-xl border border-white/20 bg-slate-950 p-3 text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none"

export default function CustomTools() {
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable">("checking")
  const [busy, setBusy] = useState(false)
  const [received, setReceived] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/feedback", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (!controller.signal.aborted) setAvailability(data?.available === true ? "available" : "unavailable") })
      .catch(() => { if (!controller.signal.aborted) setAvailability("unavailable") })
    return () => controller.abort()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || availability !== "available") return
    setError("")
    const form = new FormData(event.currentTarget)
    const answers = questions.map(({ name }) => String(form.get(name) ?? "").trim())
    if (answers.some((answer) => !answer)) {
      setError("Please answer each workflow question.")
      return
    }
    setBusy(true)
    try {
      const message = questions.map(({ label }, index) => label + "\n" + answers[index]).join("\n\n")
      const enquiry = parseFeedback({ tone: "idea", topic: customEnquiryTopic, message, email: form.get("email") })
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enquiry),
        signal: AbortSignal.timeout(15000),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.received !== true) throw new Error(data?.error || "Your enquiry could not be sent. Please try again.")
      setReceived(true)
    } catch (caught) {
      setError(caught instanceof Error && caught.name !== "TimeoutError" ? caught.message : "Sending took too long. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageSeo title="Custom Surveying Tools | SurveyTool.io" description="Discuss custom surveying tools, file conversion and reporting for your workflow." canonicalUrl="https://www.surveytool.io/custom-tools" />
      <Navbar />
      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-20 pt-32" aria-labelledby="custom-enquiry-heading">
        <h1 id="custom-enquiry-heading" className="text-4xl font-bold tracking-tight sm:text-5xl">Discuss your workflow</h1>
        <p className="mt-4 text-lg leading-8 text-slate-300">Tell us what you do today and what you’d like a custom surveying tool to produce.</p>
        {received ? (
          <p role="status" className="mt-8 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-5 text-emerald-100">We received your enquiry. We’ll reply to the email address you provided.</p>
        ) : availability !== "available" ? (
          <p role="status" className="mt-8 text-slate-300">{availability === "checking" ? "Checking enquiry availability…" : "Private enquiries are temporarily unavailable. Please try again later."}</p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
            <fieldset disabled={busy} className="space-y-5">
              <label className="block font-medium">
                Email for a reply
                <input name="email" type="email" autoComplete="email" required maxLength={254} className={fieldClass} />
              </label>
              {questions.map(({ name, label, placeholder }) => (
                <label key={name} className="block font-medium">
                  {label}
                  <textarea name={name} required maxLength={600} placeholder={placeholder} rows={3} className={fieldClass} />
                </label>
              ))}
              <p className="text-sm leading-6 text-slate-300">Your enquiry goes privately to SurveyTool. Please describe the file formats without sharing project files.</p>
              {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
              <button type="submit" className="rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60">
                {busy ? "Sending…" : "Send enquiry"}
              </button>
            </fieldset>
          </form>
        )}
      </section>
      <Footer />
    </>
  )
}
