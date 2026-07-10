import FeatureCard from "./FeatureCard"

import {
  FileText,
  Globe,
  Mountain,
  Calculator,
  MapPinned,
  ClipboardList,
} from "lucide-react"

import type { LucideIcon } from "lucide-react"

type Feature = {
  icon: LucideIcon
  title: string
  description: string
  to?: string
}

const features: Feature[] = [
  {
    icon: FileText,
    title: "CSV → DXF",
    description:
      "Convert survey point files into clean DXF drawings ready for CAD and field workflows.",
    to: "/tools/csv-to-dxf",
  },
  {
    icon: Globe,
    title: "LandXML Viewer",
    description:
      "Open and inspect LandXML files instantly without desktop software.",
    to: "/tools/landxml-viewer",
  },
  {
    icon: Mountain,
    title: "Surface Compare",
    description:
      "Compare existing and design surfaces with clear visual reports.",
  },
  {
    icon: Calculator,
    title: "Volume Calculator",
    description:
      "Calculate cut and fill volumes directly inside your browser.",
  },
  {
    icon: MapPinned,
    title: "Coordinate Converter",
    description:
      "Transform coordinates between different systems in seconds.",
  },
  {
    icon: ClipboardList,
    title: "Report Generator",
    description:
      "Generate professional survey reports automatically.",
  },
]

export default function Features() {
  return (
    <section
      id="tools"
      className="relative z-10 mx-auto max-w-7xl scroll-mt-24 px-6 pb-28"
    >
      <div className="mb-12 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
          Tools
        </p>

        <h2 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
          Powerful tools for modern surveyors
        </h2>

        <p className="mx-auto mt-5 max-w-2xl text-slate-400">
          Fast, browser-based utilities for the jobs surveyors repeat every week.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <FeatureCard
            key={feature.title}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
            to={feature.to}
          />
        ))}
      </div>
    </section>
  )
}
