import { requireAuth } from "@/lib/server/auth";
import { getServerConfig } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/errors";

const MAX_EVENTS = 60;
const MAX_EVENT_CHARS = 240;

/** Prints the phone's diagnostic events in the server console when PHONE_LOG=1. */
export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    const user = (await requireAuth(req, config)).name;
    if (!config.phoneLog) return json({ ok: false });
    const body: unknown = await req.json().catch(() => null);
    const events = (body as { events?: unknown } | null)?.events;
    const who = user ? `telefon ${user}` : "telefon";
    if (Array.isArray(events)) {
      for (const event of events.slice(0, MAX_EVENTS)) {
        if (typeof event === "string") console.log(`[${who}] ${event.slice(0, MAX_EVENT_CHARS)}`);
      }
    }
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
