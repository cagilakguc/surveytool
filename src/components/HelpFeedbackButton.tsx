import { MessageCircle } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

export default function HelpFeedbackButton() {
  const { pathname } = useLocation()
  if (pathname === "/help") return null
  return (
    <Link to="/help" aria-label="Help and feedback" className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-slate-900 px-4 py-3 text-sm font-semibold text-cyan-200 shadow-xl shadow-black/30 transition hover:border-cyan-300 hover:bg-slate-800">
      <MessageCircle size={19} />
      <span className="hidden sm:inline">Help & Feedback</span>
    </Link>
  )
}
