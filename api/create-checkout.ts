import type { VercelRequest, VercelResponse } from "@vercel/node"
import { authenticatedUser, serverClients, siteOrigin } from "./_lib.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." })
  try {
    const user = await authenticatedUser(req)
    const { stripe, supabase } = serverClients()
    const price = process.env.STRIPE_PRO_PRICE_ID
    if (!price) throw new Error("Pro price is not configured.")
    const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user.id).single()
    let customer = profile?.stripe_customer_id
    if (!customer) {
      const created = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } })
      customer = created.id
      await supabase.from("profiles").update({ stripe_customer_id: customer }).eq("id", user.id)
    }
    const origin = siteOrigin(req)
    const session = await stripe.checkout.sessions.create({ customer, mode: "subscription", line_items: [{ price, quantity: 1 }], success_url: `${origin}/dashboard?upgrade=success`, cancel_url: `${origin}/dashboard?upgrade=cancelled`, client_reference_id: user.id, metadata: { user_id: user.id }, subscription_data: { metadata: { user_id: user.id } } })
    return res.status(200).json({ url: session.url })
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Checkout failed." }) }
}
