import type { VercelRequest } from "@vercel/node"
import { createClient } from "@supabase/supabase-js"
import Stripe from "stripe"

export function serverClients() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!url || !key || !stripeKey) throw new Error("Server billing environment is incomplete.")
  return { supabase: createClient(url, key, { auth: { persistSession: false } }), stripe: new Stripe(stripeKey) }
}

export async function authenticatedUser(req: VercelRequest) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
  if (!token) throw new Error("Authentication required.")
  const { supabase } = serverClients()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error("Invalid session.")
  return data.user
}

export function siteOrigin(req: VercelRequest) {
  const host = req.headers.host
  return host?.endsWith("surveytool.io") ? `https://${host}` : "https://www.surveytool.io"
}
