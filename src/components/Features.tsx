import FeatureCard from "./FeatureCard"

import {
  FileText,
  Globe,
  Mountain,
  ScanLine,
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
    title: "CSV / TXT → DXF",
    description:
      "Create CAD-ready survey points with configurable labels, elevations and feature-code layers.",
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
      "Compare LandXML TIN surfaces with cut, fill and thickness results.",
    to: "/tools/surface-compare",
  },
  {
    icon: ScanLine,
    title: "Cross Section & Chainage",
    description:
      "Draw a section through TIN surfaces and compare CSV, TXT or DXF as-built points.",
    to: "/tools/cross-section",
  },
  {
    icon: MapPinned,
    title: "NZ Coordinate & File Converter",
    description:
      "Convert Mount Eden and NZTM coordinates, then export CSV, TXT, DXF, KML or GeoJSON.",
    to: "/tools/coordinate-converter",
  },
  {
    icon: ClipboardList,
    title: "Pavement Conformance",
    description:
      "Compare top and bottom survey points, apply thickness tolerances and export pass/fail reports.",
    to: "/tools/pavement-conformance",
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
