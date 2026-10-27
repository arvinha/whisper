import { connection } from "next/server";
import { buildIcs } from "@/lib/shared/calendar";
import type { SummaryEvent } from "@/lib/shared/types";

const LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";
}

function parseEvents(param: string | null): SummaryEvent[] {
  if (!param || param.length > 8000) return [];
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(param, "base64url").toString("utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data.slice(0, 20) : [];
  const out: SummaryEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const title = clean(e.title, 120);
    const start = clean(e.start, 16);
    const end = clean(e.end, 16);
    if (!title || !LOCAL.test(start) || !LOCAL.test(end)) continue;
    const remind = Number(e.remindMinutes);
    out.push({
      title,
      start,
      end,
      allDay: e.allDay === true,
      location: clean(e.location, 120),
      notes: clean(e.notes, 300),
      remindMinutes: Number.isFinite(remind) ? Math.max(-1, Math.min(10080, Math.round(remind))) : 30,
    });
  }
  return out;
}

/**
 * Turns calendar entries from a summary into an .ics file. Safari on iPhone opens it straight in
 * the Calendar app ("Lägg till alla"), which needs no account linking. It uses no API keys, so
 * it needs no password.
 */
export async function GET(req: Request) {
  await connection();
  const events = parseEvents(new URL(req.url).searchParams.get("e"));
  if (events.length === 0) {
    return new Response("Ogiltig kalenderlänk.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(buildIcs(events), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="whisper.ics"',
      "cache-control": "no-store",
    },
  });
}
