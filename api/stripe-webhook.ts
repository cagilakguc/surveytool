import type { VercelRequest, VercelResponse } from "@vercel/node"
import type Stripe from "stripe"
import { serverClients } from "./_lib.js"

export const config = { api: { bodyParser: false } }

async function rawBody(req: VercelRequest) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return Buffer.concat(chunks) }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end()
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    const signature = req.headers["stripe-signature"]
    if (!secret || !signature || Array.isArray(signature)) throw new Error("Webhook configuration is incomplete.")
    const { stripe, supabase } = serverClients()
    const event = stripe.webhooks.constructEvent(await rawBody(req), signature, secret)
    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription
      let userId = subscription.metadata.user_id
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id
      if (!userId) { const { data } = await supabase.from("profiles").select("id").eq("stripe_customer_id", customerId).single(); userId = data?.id }
      if (userId) {
        const active = ["active", "trialing"].includes(subscription.status)
        const periodEnd = subscription.items.data[0]?.current_period_end
        await supabase.from("subscriptions").upsert({ user_id: userId, stripe_customer_id: customerId, stripe_subscription_id: subscription.id, status: subscription.status, current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null, updated_at: new Date().toISOString() })
        await supabase.from("profiles").update({ plan: active ? "pro" : "free", updated_at: new Date().toISOString() }).eq("id", userId)
      }
    }
    return res.status(200).json({ received: true })
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Webhook failed." }) }
}
