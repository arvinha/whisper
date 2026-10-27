import type { SummaryEvent } from "./types";

/** "2026-10-20T14:00" → "20261020T140000", "2026-10-20" → "20261020". Times stay local (floating). */
function compact(local: string): string {
  const date = local.slice(0, 10).replace(/-/g, "");
  return local.length > 10 ? `${date}T${local.slice(11, 13)}${local.slice(14, 16)}00` : date;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 bytes must be folded (RFC 5545). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(events: SummaryEvent[], stamp = new Date()): string {
  const dtstamp = `${stamp.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Whisper//Aivia//SV", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  events.forEach((e, i) => {
    const uid = `${dtstamp}-${i}-${Math.random().toString(36).slice(2, 10)}@whisper`;
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${dtstamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.start)}`, `DTEND;VALUE=DATE:${compact(e.end)}`);
    } else {
      lines.push(`DTSTART:${compact(e.start)}`, `DTEND:${compact(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escapeText(e.notes)}`);
    // All-day entries remind at 09:00 the same day (or the day before); timed ones the given minutes before.
    if (e.remindMinutes >= 0) {
      const trigger = e.allDay ? (e.remindMinutes >= 1440 ? "-PT15H" : "PT9H") : `-PT${e.remindMinutes}M`;
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:${trigger}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export function googleCalendarUrl(e: SummaryEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${compact(e.start)}/${compact(e.end)}`,
  });
  if (e.notes) params.set("details", e.notes);
  if (e.location) params.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

