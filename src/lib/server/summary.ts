import type {
  LanguagePref,
  SummaryEvent,
  SummaryKind,
  SummaryRequest,
  SummaryResult,
  SummaryTask,
} from "@/lib/shared/types";
import { LANGUAGE_CODES } from "@/lib/shared/types";
import { parseJsonLoose } from "./answer";
import type { LlmConfig } from "./config";
import { AppError } from "./errors";
import { chat } from "./llm";

const LANGUAGE_NAME: Record<string, string> = { sv: "Swedish", da: "Danish", en: "English" };
const KINDS: ReadonlyArray<Exclude<SummaryKind, "auto">> = [
  "meeting",
  "lecture",
  "conversation",
  "debate",
  "presentation",
];

const KIND_FOCUS: Record<Exclude<SummaryKind, "auto">, string> = {
  meeting: "decisions, who does what, deadlines and the next meeting",
  lecture:
    "key concepts with short definitions, examples, what is likely to come up on an exam, and any assignments or deadlines",
  conversation:
    "what was talked about, things worth remembering about the people (names, plans, dates, preferences) and anything promised",
  debate: "each side's position, their strongest arguments and claimed facts, and where they agree",
  presentation: "the main message, the structure, key numbers, and questions from the audience",
};

const MAX_ITEMS = 12;

function languageRule(pref: LanguagePref): string {
  if (pref === "auto") {
    return "Write in the main language of the transcript, or of the user's request when nothing was recorded. If that is unclear, write in Swedish.";
  }
  return `Always write in ${LANGUAGE_NAME[pref]}.`;
}

function localStamp(at: number, offsetMinutes: number): string {
  return new Date(at + offsetMinutes * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

/** Lines from the memory can span days, so they get the date too unless all are from today. */
function formatLines(req: SummaryRequest, from: number, to: number): string {
  const today = req.now.slice(0, 10);
  const withDate = req.lines.some((l) => localStamp(l.at, req.utcOffsetMinutes).slice(0, 10) !== today);
  return req.lines
    .slice(from, to)
    .map((l) => {
      const stamp = localStamp(l.at, req.utcOffsetMinutes);
      return `[${withDate ? stamp : stamp.slice(11)}] ${l.me ? "Jag: " : ""}${l.text}`;
    })
    .join("\n");
}

/** Splits the transcript into parts of at most `maxChars`, at line boundaries. */
function chunkRanges(req: SummaryRequest, maxChars: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  let chars = 0;
  req.lines.forEach((l, i) => {
    const size = l.text.length + 14;
    if (chars + size > maxChars && i > start) {
      ranges.push([start, i]);
      start = i;
      chars = 0;
    }
    chars += size;
  });
  if (start < req.lines.length) ranges.push([start, req.lines.length]);
  return ranges;
}

const INTRO = `You are "Aivia", the note-taker and calendar helper inside the app "Whisper", an earbud assistant. The user let you listen to something (a meeting, lecture, conversation, debate or presentation), or just asks you for something.

The transcript comes from automatic speech recognition. Each line starts with the clock time it was said (and the date, when the lines span more than today). There are no speaker labels, except that lines starting with "Jag:" were said by the user. It may contain recognition errors and fragments; silently correct obvious mistakes. Never invent facts, names, numbers or dates that are not in the transcript.`;

const EVENT_RULES = `Resolve relative dates ("på fredag", "imorgon kl 14", "nästa vecka") from the current local time given below, or from the date of the line where it was said when that is earlier; if only a week is given, use its Monday. "start"/"end" are local "YYYY-MM-DDTHH:mm"; without a time of day use "allDay": true and "YYYY-MM-DD". If a timed event has no end, end it one hour after the start. "remindMinutes" is how long before the start to remind (30 if nothing is said; 0 when the user asks to be reminded at that time, e.g. "påminn mig kl 10"). A request like "påminn mig att ringa mamma imorgon kl 10" is an event titled with the thing to do ("Ring mamma"). "notes" is one sentence of context.`;

const JSON_SHAPE = `{"title":"","kind":"meeting","summary":"","points":[],"decisions":[],"tasks":[{"text":"","who":"","due":""}],"events":[{"title":"","start":"","end":"","allDay":false,"location":"","notes":"","remindMinutes":30}],"openQuestions":[],"positions":[{"who":"","view":""}],"reply":"","lang":"sv"}`;

const MEMORY_INTRO = `You are "Aivia", the assistant inside the app "Whisper". With the user's permission the app listens in the background through the day and keeps a written memory of what was said, on the user's own phone.

The memory comes from automatic speech recognition. Each line starts with the date and time it was said. There are no speaker labels, except that lines starting with "Jag:" were said by the user. It may contain recognition errors, fragments, TV or radio in the background, and other people's talk; silently correct obvious mistakes. Never invent facts, names, numbers or dates that are not in it.`;

function assistPrompt(req: SummaryRequest): string {
  return `${MEMORY_INTRO}

Now the user talks or writes to you directly. You get their request, the current local time and excerpts from the memory: the latest minutes plus stretches that matched words in the request, so some lines will be unrelated. You may also get notes about earlier stretches of the day, and material the user uploaded.

Do what the user asks: answer a question about something said earlier, find a detail, draft a message, explain something, or put things in the calendar and reminders. When the request points at something heard ("det där om tandläkaren", "vad sa läkaren", "the thing Sara asked me"), find it in the memory and use its exact details: day, time, place, names. If it is not in the memory, say so in one sentence and suggest what the user can say instead; never guess. Questions that do not need the memory you answer from your own knowledge.

Fill in this JSON. Leave a list empty when there is nothing for it.
- "reply": your answer, ready to be read aloud in the user's earbud. Start with the direct answer in one short sentence; add details only when they help, at most four sentences in total. Exception: when the user asks for a text (an email, a message, a list), write the text in full after one short sentence. Plain text, no markdown. If you put something in the calendar, confirm what and when in a few words.
- "title": at most 6 words about the request.
- "events": only calendar entries or reminders the user asks for in this request, never other appointments that happen to be in the memory. ${EVENT_RULES}
- "tasks": only to-dos the user asks you to note in this request. "who" is "jag" for the user. "due" is "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" if a time was said, otherwise "".
- "summary", "points", "decisions", "openQuestions", "positions": leave empty.
- "kind": "conversation".
- "lang": ISO 639-1 code of the language you wrote in.

${req.language === "auto" ? "Write in the language of the user's request." : languageRule(req.language)}

Reply with JSON only, exactly in this shape:
${JSON_SHAPE}`;
}

function digestPrompt(req: SummaryRequest): string {
  return `${MEMORY_INTRO}

You keep the user's diary. You get one stretch of the day from the memory. Write a short note about it and pick out what the user must not forget. Be strict: a wrong suggestion is worse than a missing one.

Fill in this JSON. Leave a list empty when there is nothing for it; never pad.
- "title": at most 6 words saying what the stretch was about, concretely (e.g. "Läkarbesök om knät", "Lunch med Sara", "Föreläsning om inflation").
- "summary": one or two sentences with the essence, with names, numbers and places. If the stretch is only noise, fragments, TV or radio, or impossible to follow, write "" and leave everything else empty.
- "events": only appointments, meetings, deadlines and reminders that concern the user and have a day or date said clearly enough to put in a calendar (e.g. "vi ses på tisdag kl 14", "din nästa tid är den 4 november", "provet är på fredag", "påminn mig att ringa mamma imorgon"). Never things that only concern others, things that already happened, or vague plans ("vi borde ses nån gång"). ${EVENT_RULES}
- "tasks": only clear things the user promised or was asked to do ("jag skickar det imorgon", "kan du ringa banken"), with "who" "jag". "due" is "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" if a time was said, otherwise "". Skip a task that is already an event.
- "kind": one of ${KINDS.join(", ")}.
- "points", "decisions", "openQuestions", "positions", "reply": leave empty.
- "lang": ISO 639-1 code of the language you wrote in.

${languageRule(req.language)}

Reply with JSON only, exactly in this shape:
${JSON_SHAPE}`;
}

function notesPrompt(part: number, total: number): string {
  return `${INTRO}

This is part ${part} of ${total} of a long recording. Write compact but complete notes of this part only, as plain text bullet lines: every topic, fact, number, name, decision, task (with who and when), date or appointment mentioned (keep relative dates as said, with the clock time), open question and opinion. Write in the language of the transcript. No introduction.`;
}

function finalPrompt(req: SummaryRequest, fromNotes: boolean): string {
  const kindLine =
    req.kind === "auto"
      ? `Decide what kind of recording it is. Focus on what matters for that kind, for example ${Object.entries(KIND_FOCUS)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ")}.`
      : `The user says this was a ${req.kind}. Focus on ${KIND_FOCUS[req.kind]}.`;
  return `${INTRO}
${fromNotes ? "\nThe recording was long, so you get notes of its parts in order instead of the full transcript.\n" : ""}
${kindLine}

Fill in this JSON. Leave a list empty when there is nothing for it; never pad.
- "title": at most 8 words.
- "kind": one of ${KINDS.join(", ")}.
- "summary": 2-4 sentences with the essence of the recording. It is only about what was said in the recording, never about the user's request; with nothing recorded, "".
- "points": the most important points, at most ${MAX_ITEMS}, each one short sentence with concrete details.
- "decisions": what was decided or agreed.
- "tasks": things someone should do. Something that is an appointment or reminder at a set time goes in "events" only, not here too. "who" is "jag" for the user, a name if known, otherwise "". "due" is a local date "YYYY-MM-DD" or date and time "YYYY-MM-DDTHH:mm" if one was said, otherwise "".
- "events": things worth a calendar entry: meetings, appointments, deadlines, exams, birthdays, follow-ups mentioned with a day or date. ${EVENT_RULES}
- "openQuestions": unanswered questions and things to follow up.
- "positions": only for debates or clear disagreements: who (a name, "Jag" or a description like "den ena sidan") and their view.
- "reply": if the user gave a request, your answer to it, ready to use (e.g. a drafted email or message, or the answer to a question about the content). If the request is to add something to the calendar or set a reminder, put it in "events" and confirm it in one short sentence here. Without a request, "".
- "lang": ISO 639-1 code of the language you wrote in.

Style: plain, clear language, no markdown. ${languageRule(req.language)}

Reply with JSON only, exactly in this shape:
${JSON_SHAPE}`;
}

function contextHeader(req: SummaryRequest): string {
  const weekday = new Date(`${req.now.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  const parts = [`Current local time: ${req.now} (${weekday})${req.timeZone ? `, time zone ${req.timeZone}` : ""}`];
  // Models often get the weekday of a nearby date wrong; a small calendar avoids that.
  const today = Date.parse(`${req.now.slice(0, 10)}T12:00:00Z`);
  if (Number.isFinite(today)) {
    const days = Array.from({ length: 21 }, (_, i) => {
      const d = new Date(today + (i - 7) * 86_400_000);
      return `${d.toISOString().slice(0, 10)} ${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;
    });
    parts.push(`Calendar: ${days.join(", ")}`);
  }
  if (req.profile) parts.push(`About the user: ${req.profile}`);
  if (req.context) {
    parts.push(
      req.purpose === "assist"
        ? `Background: diary notes about earlier stretches and material the user uploaded:\n${req.context}`
        : `Material the user prepared beforehand (background only: use it to get names, terms and context right and to connect tasks to it, but do not summarize it):\n${req.context}`,
    );
  }
  if (req.instruction) parts.push(`The user's request: ${req.instruction}`);
  return parts.join("\n");
}

// ---- parsing ---------------------------------------------------------------------------------

function text(value: unknown, max = 600): string {
  return typeof value === "string" ? value.replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => text(v, 400)).filter(Boolean).slice(0, MAX_ITEMS * 2) : [];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function localTime(value: unknown): string {
  const t = text(value, 40).replace(" ", "T").slice(0, 16);
  if (DATE_TIME.test(t) || DATE.test(t)) return t;
  return DATE.test(t.slice(0, 10)) ? t.slice(0, 10) : "";
}

function addHour(start: string): string {
  const d = new Date(`${start}:00Z`);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().slice(0, 16);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseTasks(value: unknown): SummaryTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
    .map((v) => ({ text: text(v.text, 300), who: text(v.who, 60), due: localTime(v.due) }))
    .filter((t) => t.text)
    .slice(0, MAX_ITEMS * 2);
}

function parseEvents(value: unknown): SummaryEvent[] {
  if (!Array.isArray(value)) return [];
  const out: SummaryEvent[] = [];
  for (const raw of value.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const title = text(v.title, 120);
    let start = localTime(v.start);
    if (!title || !start) continue;
    const allDay = v.allDay === true || DATE.test(start);
    if (allDay) start = start.slice(0, 10);
    let end = localTime(v.end);
    if (allDay) end = DATE.test(end) && end > start ? end : nextDay(start);
    else if (!DATE_TIME.test(end) || end <= start) end = addHour(start);
    const remind = Number(v.remindMinutes);
    out.push({
      title,
      start,
      end,
      allDay,
      location: text(v.location, 120),
      notes: text(v.notes, 300),
      remindMinutes: Number.isFinite(remind) ? Math.max(0, Math.min(10080, Math.round(remind))) : 30,
    });
  }
  return out;
}

function parsePositions(value: unknown): SummaryResult["positions"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
    .map((v) => ({ who: text(v.who, 60), view: text(v.view, 400) }))
    .filter((p) => p.view)
    .slice(0, 8);
}

function mockSummary(req: SummaryRequest): Omit<SummaryResult, "model" | "ms" | "minutes"> {
  const day = req.now.slice(0, 10);
  const empty = { summary: "", points: [], decisions: [], tasks: [], events: [], openQuestions: [], positions: [], lang: "sv" };
  if (req.purpose === "assist") {
    return { ...empty, title: "(Testläge) Fråga", kind: "conversation", reply: "(Testläge) Här kommer svaret på det du bad om." };
  }
  if (req.purpose === "digest") {
    return {
      ...empty,
      title: "(Testläge) Samtal",
      kind: "conversation",
      summary: "En påhittad anteckning om den här stunden.",
      reply: "",
    };
  }
  return {
    title: "(Testläge) Veckomöte om projektet",
    kind: "meeting",
    summary: "Det här är en påhittad sammanfattning. Med en riktig API-nyckel sammanfattas det som faktiskt sades.",
    points: ["Lanseringen flyttas en vecka.", "Budgeten räcker till två nya annonser."],
    decisions: ["Erik ansvarar för testerna."],
    tasks: [{ text: "Skicka offerten till kunden", who: "jag", due: day }],
    events: [
      {
        title: "Uppföljningsmöte",
        start: `${nextDay(day)}T14:00`,
        end: `${nextDay(day)}T15:00`,
        allDay: false,
        location: "",
        notes: "Gå igenom testresultaten.",
        remindMinutes: 30,
      },
    ],
    openQuestions: ["Vem håller i presentationen?"],
    positions: [],
    reply: req.instruction ? "(Testläge) Här kommer svaret på din begäran." : "",
    lang: "sv",
  };
}

export async function generateSummary(
  cfg: LlmConfig,
  req: SummaryRequest,
  opts: { frugal: boolean; signal: AbortSignal },
): Promise<SummaryResult> {
  const started = Date.now();
  const minutes =
    req.lines.length > 0 ? Math.max(1, Math.round((req.lines.at(-1)!.at - req.lines[0].at) / 60_000)) : 0;
  const fallbackLang = req.language === "auto" ? "sv" : req.language;

  if (cfg.provider === "mock") {
    await new Promise((r) => setTimeout(r, 800));
    return { ...mockSummary(req), model: "mock", ms: Date.now() - started, minutes };
  }

  const header = contextHeader(req);
  const limit = opts.frugal ? 9_000 : 60_000;
  if (req.purpose === "assist" || req.purpose === "digest") {
    // The phone already picked the lines, so keep the newest within the limit in one call.
    let from = req.lines.length;
    for (let chars = 0; from > 0 && chars + req.lines[from - 1].text.length + 20 <= limit; from--) {
      chars += req.lines[from - 1].text.length + 20;
    }
    const assist = req.purpose === "assist";
    const lines = from < req.lines.length ? formatLines(req, from, req.lines.length) : "(nothing recorded)";
    const raw = await chat(cfg, {
      system: assist ? assistPrompt(req) : digestPrompt(req),
      user: `${header}\n\nMemory, oldest first:\n${lines}`,
      maxTokens: assist ? 2500 : 1200,
      temperature: 0.2,
      json: true,
      signal: opts.signal,
    });
    return toResult(raw, req, cfg, started, minutes, fallbackLang);
  }

  const ranges = chunkRanges(req, limit);
  let body: string;
  if (ranges.length <= 1) {
    body = `Transcript, oldest first:\n${req.lines.length > 0 ? formatLines(req, 0, req.lines.length) : "(nothing recorded)"}`;
  } else {
    // Long recordings: notes per part (a few in parallel), then one summary of the notes.
    const notes: string[] = new Array<string>(ranges.length);
    const parallel = opts.frugal ? 1 : 3;
    for (let i = 0; i < ranges.length; i += parallel) {
      await Promise.all(
        ranges.slice(i, i + parallel).map(async ([from, to], j) => {
          const index = i + j;
          notes[index] = await chat(cfg, {
            system: notesPrompt(index + 1, ranges.length),
            user: `Transcript part ${index + 1}, oldest first:\n${formatLines(req, from, to)}`,
            maxTokens: 1800,
            temperature: 0.2,
            json: false,
            signal: opts.signal,
          });
        }),
      );
    }
    body = notes.map((n, i) => `Notes, part ${i + 1} of ${notes.length}:\n${n}`).join("\n\n");
  }

  const raw = await chat(cfg, {
    system: finalPrompt(req, ranges.length > 1),
    user: `${header}\n\n${body}`,
    maxTokens: 4000,
    temperature: 0.2,
    json: true,
    signal: opts.signal,
  });
  return toResult(raw, req, cfg, started, minutes, fallbackLang);
}

function toResult(
  raw: string,
  req: SummaryRequest,
  cfg: LlmConfig,
  started: number,
  minutes: number,
  fallbackLang: string,
): SummaryResult {
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new AppError(502, "provider_error", "Modellen gav ingen läsbar sammanfattning. Försök igen.");

  const kind = KINDS.find((k) => k === parsed.kind) ?? (req.kind === "auto" ? "conversation" : req.kind);
  const code = text(parsed.lang, 5).toLowerCase().slice(0, 2);
  const lang =
    req.language !== "auto" && (LANGUAGE_CODES as readonly string[]).includes(req.language)
      ? req.language
      : /^[a-z]{2}$/.test(code)
        ? code
        : fallbackLang;

  return {
    title: text(parsed.title, 120) || "Sammanfattning",
    kind,
    summary: text(parsed.summary, 1500),
    points: textList(parsed.points).slice(0, MAX_ITEMS),
    decisions: textList(parsed.decisions),
    tasks: parseTasks(parsed.tasks),
    events: parseEvents(parsed.events),
    openQuestions: textList(parsed.openQuestions),
    positions: parsePositions(parsed.positions),
    reply: typeof parsed.reply === "string" ? parsed.reply.replace(/[*`#]+/g, "").trim().slice(0, 4000) : "",
    lang,
    model: cfg.model,
    ms: Date.now() - started,
    minutes,
  };
}
