export type Plan = "free" | "pro"

export type Profile = {
  id: string
  full_name: string | null
  plan: Plan
}

export type Project = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export type ProjectFile = {
  id: string
  project_id: string
  file_name: string
  file_size: number
  file_type: string
  storage_path: string
  created_at: string
}

export const planLimits = {
  free: { maximumFileSize: 10 * 1024 * 1024, maximumProjects: 1, reports: false, surfaceCompare: false },
  pro: { maximumFileSize: 250 * 1024 * 1024, maximumProjects: Number.POSITIVE_INFINITY, reports: true, surfaceCompare: true },
} satisfies Record<Plan, { maximumFileSize: number; maximumProjects: number; reports: boolean; surfaceCompare: boolean }>
