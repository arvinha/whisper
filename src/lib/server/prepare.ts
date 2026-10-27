import type { LanguagePref, PrepareRequest, PrepBrief, PrepKind } from "@/lib/shared/types";
import { LANGUAGE_CODES } from "@/lib/shared/types";
import { parseJsonLoose } from "./answer";
import type { LlmConfig } from "./config";
import { AppError } from "./errors";
import { chat } from "./llm";

const LANGUAGE_NAME: Record<string, string> = { sv: "Swedish", da: "Danish", en: "English" };

const KIND_TEXT: Record<PrepKind, string> = {
  interview:
    "a job interview. Questions will be about the user's background, experience, motivation, strengths and weaknesses, concrete situations (STAR), salary and why this role and company",
  meeting: "a meeting. Questions will be about the user's area, status, numbers, proposals and next steps",
  presentation:
    "a presentation the user gives, followed by questions from the audience or teachers about the content, method, sources and conclusions",
  exam: "an oral exam or test. Questions will check understanding of the material: definitions, explanations, examples and connections",
  sales: "a sales or customer meeting. Questions will be about the offer, price, objections, competitors and results",
  other: "a conversation where the user wants to come across as prepared and knowledgeable",
};

function languageRule(pref: LanguagePref): string {
  if (pref === "auto") return "Write in the language the situation will be held in, judging from the material. If unclear, write in Swedish.";
  return `Always write in ${LANGUAGE_NAME[pref]}.`;
}

function systemPrompt(req: PrepareRequest): string {
  return `You are "Aivia", the preparation coach inside the app "Whisper", an earbud assistant that whispers answers to the user during live conversations. The user is preparing for ${KIND_TEXT[req.kind]}.

You get what the user uploaded (for example their CV, cover letter, the job ad, project descriptions, slides or notes) and what they want to achieve. Prepare them so they can give concrete, specific answers.

Rules:
- Ground everything in the material: real names, employers, projects, years, numbers, tools, results, and the exact requirements or points in a job ad, agenda or slides.
- Pages read from links (the job ad, the employer's website) show what the role and the company are about: use their requirements, products, customers and values, and include at least one question on why this company.
- Code projects (sections "### Fil: path") are the user's own work. Include questions an interviewer would ask about them (what it does, the architecture, a technical choice, a hard problem, how they would improve it) with answers that name the real classes, functions, tables, libraries and patterns in the code. Only claim what the code shows.
- Never invent experience, results or facts the material does not support. Where the material is thin, say what the user should fill in themselves.
- Answers are in the user's own voice, first person, natural spoken language they can say out loud. No markdown, no lists inside answers.
- ${languageRule(req.language)}

Fill in this JSON:
- "title": at most 6 words naming the situation, e.g. "Intervju Spotify, backendutvecklare".
- "pitch": how the user presents themselves here, 3-4 spoken sentences ("Berätta om dig själv"), tailored to the situation.
- "facts": up to 15 short facts worth having in mind: numbers, names, dates, projects, key requirements and how the user meets them.
- "questions": the 10-12 most likely questions, the hardest and most specific included, each with an answer of 2-4 sentences.
- "askThem": up to 5 smart questions the user can ask.
- "watchOut": up to 4 weak spots or tricky points (a requirement the user lacks, a gap, a weak result) with one sentence on how to handle each.
- "lang": ISO 639-1 code of the language you wrote in.

Reply with JSON only, exactly in this shape:
{"title":"","pitch":"","facts":[],"questions":[{"q":"","a":""}],"askThem":[],"watchOut":[],"lang":"sv"}`;
}

function userPrompt(req: PrepareRequest): string {
  const parts: string[] = [];
  if (req.title) parts.push(`The user's name for the situation: ${req.title}`);
  if (req.profile) parts.push(`About the user: ${req.profile}`);
  if (req.notes) parts.push(`What the user wants to achieve or highlight:\n${req.notes}`);
  for (const doc of req.docs) parts.push(`=== ${doc.name} ===\n${doc.text}`);
  return parts.join("\n\n");
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function textList(value: unknown, maxItems: number): string[] {
  return Array.isArray(value) ? value.map((v) => text(v, 400)).filter(Boolean).slice(0, maxItems) : [];
}

function mockBrief(req: PrepareRequest): Omit<PrepBrief, "model" | "ms"> {
  return {
    title: req.title || "(Testläge) Förberedelse",
    pitch: "(Testläge) Här kommer en kort presentation av dig, byggd på det du laddat upp.",
    facts: req.docs.map((d) => `${d.name}: ${d.text.slice(0, 60)}`),
    questions: [{ q: "Berätta om dig själv.", a: "(Testläge) Ett konkret svar byggt på ditt underlag." }],
    askThem: ["Hur ser en vanlig vecka ut i rollen?"],
    watchOut: [],
    lang: "sv",
  };
}

export async function generateBrief(
  cfg: LlmConfig,
  req: PrepareRequest,
  opts: { frugal: boolean; signal: AbortSignal },
): Promise<PrepBrief> {
  const started = Date.now();
  if (cfg.provider === "mock") {
    await new Promise((r) => setTimeout(r, 800));
    return { ...mockBrief(req), model: "mock", ms: Date.now() - started };
  }

  // Groq's free tier allows only a few thousand tokens per minute.
  const docs = opts.frugal ? req.docs.map((d) => ({ ...d, text: d.text.slice(0, 2500) })) : req.docs;
  const raw = await chat(cfg, {
    system: systemPrompt(req),
    user: userPrompt({ ...req, docs }),
    maxTokens: opts.frugal ? 2500 : 6000,
    temperature: 0.4,
    json: true,
    signal: opts.signal,
  });
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new AppError(502, "provider_error", "Modellen gav ingen läsbar förberedelse. Försök igen.");

  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((item) => {
          const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return { q: text(entry.q, 300), a: text(entry.a, 900) };
        })
        .filter((x) => x.q && x.a)
        .slice(0, 15)
    : [];
  const code = text(parsed.lang, 5).toLowerCase().slice(0, 2);
  const lang =
    req.language !== "auto" && (LANGUAGE_CODES as readonly string[]).includes(req.language)
      ? req.language
      : /^[a-z]{2}$/.test(code)
        ? code
        : "sv";

  return {
    title: text(parsed.title, 120) || req.title || "Förberedelse",
    pitch: text(parsed.pitch, 1500),
    facts: textList(parsed.facts, 20),
    questions,
    askThem: textList(parsed.askThem, 6),
    watchOut: textList(parsed.watchOut, 6),
    lang,
    model: cfg.model,
    ms: Date.now() - started,
  };
}
