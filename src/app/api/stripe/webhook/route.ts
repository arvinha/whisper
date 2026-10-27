import { handleWebhook, verifyWebhook } from "@/lib/server/billing";

/** Stripe calls this after payments and subscription changes. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("stripe-signature"))) {
    return new Response("bad signature", { status: 400 });
  }
  try {
    await handleWebhook(JSON.parse(body));
    return Response.json({ received: true });
  } catch (err) {
    console.error("[whisper] webhook failed", err);
    return new Response("webhook failed", { status: 500 });
  }
}
