import type { VercelRequest, VercelResponse } from "@vercel/node"
import { authenticatedUser, serverClients, siteOrigin } from "./_lib.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." })
  try {
    const user = await authenticatedUser(req)
    const { stripe, supabase } = serverClients()
    const { data } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user.id).single()
    if (!data?.stripe_customer_id) throw new Error("No billing account found.")
    const session = await stripe.billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${siteOrigin(req)}/dashboard` })
    return res.status(200).json({ url: session.url })
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Portal failed." }) }
}
