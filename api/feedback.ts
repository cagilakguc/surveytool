import { randomUUID, createHash } from "node:crypto"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClient } from "@supabase/supabase-js"
import { parseFeedback } from "../src/lib/feedback.js"

const bucketName = "site-feedback"
const submissions = new Map<string, { count: number; until: number }>()
let bucketReady: Promise<void> | null = null

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store")
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (req.method === "GET") return res.status(200).json({ available: Boolean(url && key) })
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST")
    return res.status(405).json({ error: "Method not allowed." })
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return res.status(415).json({ error: "Please send feedback from the feedback form." })
  }
  if (Number(req.headers["content-length"] || 0) > 8192) return res.status(413).json({ error: "This feedback is too long." })

  let feedback
  try { feedback = parseFeedback(req.body) }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Please check your feedback." }) }
  if (!url || !key) return res.status(503).json({ error: "Private feedback is temporarily unavailable. You can use the public GitHub feedback option below." })

  const now = Date.now()
  const ip = String(req.headers["x-vercel-forwarded-for"] || req.headers["x-forwarded-for"] || "unknown").split(",")[0]
  const sender = createHash("sha256").update(ip).digest("hex")
  const recent = submissions.get(sender)
  if (recent && recent.until > now && recent.count >= 5) {
    res.setHeader("Retry-After", "600")
    return res.status(429).json({ error: "Please wait a few minutes before sending more feedback." })
  }
  for (const [id, entry] of submissions) if (entry.until <= now) submissions.delete(id)
  if (submissions.size >= 1000) submissions.delete(submissions.keys().next().value as string)
  submissions.set(sender, { count: recent && recent.until > now ? recent.count + 1 : 1, until: recent && recent.until > now ? recent.until : now + 600_000 })

  try {
    const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage
    if (!bucketReady) {
      bucketReady = (async () => {
        const existing = await storage.getBucket(bucketName)
        if (existing.data) {
          if (existing.data.public) throw new Error("Feedback storage must be private.")
          return
        }
        if (existing.error && String(existing.error.statusCode) !== "404" && !/not found/i.test(existing.error.message)) throw existing.error
        const created = await storage.createBucket(bucketName, { public: false, fileSizeLimit: 8192, allowedMimeTypes: ["application/json"] })
        if (created.error && String(created.error.statusCode) !== "409" && !/already exists/i.test(created.error.message)) throw created.error
        const checked = await storage.getBucket(bucketName)
        if (checked.error || !checked.data || checked.data.public) throw new Error("Private feedback storage is unavailable.")
      })().catch((error) => { bucketReady = null; throw error })
    }
    await bucketReady
    const destination = await storage.getBucket(bucketName)
    if (destination.error || !destination.data || destination.data.public) throw new Error("Private feedback storage is unavailable.")
    const id = randomUUID()
    const sentAt = new Date().toISOString()
    const record = { id, sentAt, tone: feedback.tone, topic: feedback.topic, message: feedback.message, ...(feedback.email ? { email: feedback.email } : {}) }
    const saved = await storage.from(bucketName).upload(`${sentAt.slice(0, 10)}/${id}.json`, Buffer.from(JSON.stringify(record)), { contentType: "application/json", upsert: false })
    if (saved.error) throw saved.error
    return res.status(201).json({ received: true, id })
  } catch {
    return res.status(503).json({ error: "Your feedback could not be saved. Please try again, or use the public GitHub option below." })
  }
}
