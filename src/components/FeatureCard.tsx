import { Link } from "react-router-dom"
import type { LucideIcon } from "lucide-react"

type FeatureCardProps = {
  icon: LucideIcon
  title: string
  description: string
  to?: string
}

export default function FeatureCard({
  icon: Icon,
  title,
  description,
  to,
}: FeatureCardProps) {
  const cardContent = (
    <>
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300 transition group-hover:bg-cyan-400 group-hover:text-slate-950">
        <Icon size={28} />
      </div>

      <h3 className="text-xl font-bold">
        {title}
      </h3>

      <p className="mt-4 leading-7 text-slate-400">
        {description}
      </p>

      <div className="mt-6 font-semibold text-cyan-300">
        {to ? "Open tool →" : "Coming soon"}
      </div>
    </>
  )

  const className =
    "group block rounded-3xl border border-white/10 bg-white/3 p-7 transition-all duration-300 hover:-translate-y-2 hover:border-cyan-400/40 hover:bg-white/5 hover:shadow-2xl hover:shadow-cyan-500/10"

  if (to) {
    return (
      <Link to={to} className={className}>
        {cardContent}
      </Link>
    )
  }

  return (
    <div className={className}>
      {cardContent}
    </div>
  )
}