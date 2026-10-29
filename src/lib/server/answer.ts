import type {
  AnsweredItem,
  AnswerKind,
  AnswerRequest,
  AnswerResult,
  AnswerStyle,
  LanguageCode,
  LanguagePref,
  TranscriptLine,
} from "@/lib/shared/types";
import { LANGUAGE_CODES } from "@/lib/shared/types";
import { FILE_MARK, searchMaterial, type SearchDoc } from "@/lib/shared/materialSearch";
import type { LlmConfig } from "./config";
import { AppError } from "./errors";
import { liveLookups } from "./live";
import { chat, type LocalTool } from "./llm";

const SHORT_MAX_WORDS = 25;
const OPENER_MAX_WORDS = 14;
const DETAIL_MAX_WORDS = 80;
const DEEP_MAX_WORDS = 90;
const ANSWERED_TAG = "[Aivia answered]";

const LANGUAGE_NAME: Record<string, string> = { sv: "Swedish", da: "Danish", en: "English" };

const STYLE_TEXT: Record<AnswerStyle, string> = {
  smart:
    "smart but relaxed, like a well-read friend: casual wording, sharp content, confident tone",
  expert:
    "precise and authoritative, like a domain expert; use one exact term, name or number when it helps",
  witty:
    "quick-witted and charming: a light clever twist or wordplay, but still correct and useful",
};

const INTRO = `You are "Aivia", the discreet assistant inside the app "Whisper", who whispers into the user's earbud during a live, face-to-face conversation. The user wants to come across as sharp, knowledgeable and quick-witted. They will repeat your words out loud right away, so write exactly what they should say.

You get a live transcript from automatic speech recognition. It has no speaker labels and may contain recognition errors, missing words and fragments; silently correct obvious mistakes. The newest lines are at the bottom, and each line starts with how many seconds ago it was said.`;

const COMMON_RULES = `- Spoken, natural language that sounds like the user, not like an encyclopedia. First person where natural.
- Start directly with the substance. No filler ("Good question", "Well,"), no lists, no markdown, no emojis, no quotation marks around the answer.
- Never mention AI, assistants, transcripts or that you are helping.
- Be factually correct. If the honest answer is uncertain or debated, say so briefly in a smart way instead of guessing.
- Everything you know is in this message, including anything the app fetched from the internet just now. You cannot open anything else yourself or come back later, so never say or imply that you will ("let me check", "I'll open the file"), and never claim to quote something you cannot see here.
- For personal questions (the user's life, experience, opinions, plans), use the prepared material and the user profile when there are any; otherwise give a likeable, plausible answer that stays general and invents no specific facts.`;

/** Goes with the user's prepared material, after the task-specific system prompt. */
function contextBlock(context: string): string {
  return `PREPARED MATERIAL
The user prepared for this situation and gave you the material below: for example their CV, cover letter, the job ad, project descriptions, slides, an agenda or notes. It is your main source for anything about the user, their experience and work, and the subject of the situation.
- When the question or topic touches the material, answer with concrete details from it: real project names, employers, years, numbers, tools, results, and the exact points the job ad, agenda or slides make. A specific answer always beats a generic one.
- Speak as the user, in first person, as someone who lived it. Never mention documents, a CV or "the material".
- Never invent experience, employers, degrees, results or numbers the material does not support. If nothing in it fits, give a strong honest answer and, where natural, bridge to something the material does contain.
- Do not make up how the user's own projects went (steps, problems, colleagues, numbers) beyond what the material says; the user may get follow-up questions about it. To say more, explain the general approach ("in that kind of migration you…") or why it mattered.
- In an interview, link the user's experience to what the role asks for. In a presentation or exam, stick to the facts and wording of the material.
- Pages read from links (a job ad, the employer's website) tell what the role and company are about: use their exact requirements, products, values and wording, and connect the user's experience to them.
- Code projects (sections "### Fil: path") are the user's own work. When asked about a project, the code, a technology or how they solved something, answer like the developer who wrote it: name the real classes, functions, tables, endpoints, libraries and patterns, say what they do and why that choice made sense. Explain only what the code shows; for results or history the code does not show, describe the approach instead. The message may add the code parts that match the current question.
- Asked to point to a file or a line: every code line here starts with its line number ("12| "), also in code fetched from GitHub just now. Name the file and the exact line or lines and say what that code does and why it is written that way. Pick code that shows the user's skill, never a flaw. Never say you do not have the files or line numbers in front of you when numbered code is in this message.
- Documents such as a thesis or report count as the user's work too, including their data sources, references (a bibliography, "\\cite{…}", "@misc{…}") and acknowledgements. Asked where data or facts came from or whether a source was credited, name the concrete source as written there (who made it, what it is, where it is found) and how the user credited it.
- Questions unrelated to the material are answered as usual.
- The material may be in another language than the conversation. That never changes the answer language: follow the language rule in your instructions above.

${context}

(End of the prepared material.)`;
}

function languageRule(pref: LanguagePref): string {
  if (pref === "auto") {
    return "Write in the language of the conversation (the language the question was asked in). If that is unclear, write in Swedish.";
  }
  return `Always write in ${LANGUAGE_NAME[pref]}.`;
}

/** With prepared material, questions about it get an opener now and the concrete answer right after. */
const DEEP_STEP = `
4. Decide "deep". It is true when answering well needs the user's own material: any question about their projects or code (how something works, a file, a line, a choice, tests, problems), their work, experience, CV or education, or the job or company in the material, also follow-ups and questions about something the material may lack. A stronger model then reads all of the material and gives the real answer right after yours. Otherwise "deep" is false.`;

function liveStep(n: number): string {
  return `
${n}. Decide "live". It is true when a correct answer needs something you cannot know from this message: current news, prices, rates, results, weather, opening hours, recent releases or events, the newest changes in the user's GitHub code, or what a website or link mentioned in the conversation says (for example "teknikfix.dk"). It is also true for specific facts the prepared material does not cover and that are not about the user's own life: the company, organization or people the user is meeting (what they do, their products, customers, news, numbers, plans, values), a named product, law, study or statistic. The app then looks it up on the internet and gives the real answer right after yours. General knowledge you are sure of (how a technology works, a well-known concept) does not need it. Otherwise "live" is false.`;
}

function openerRule(flags: string): string {
  return `- When ${flags} is true, "answer" is ONLY an opener the user can start saying while the real answer is fetched: one natural sentence of at most ${OPENER_MAX_WORDS} words. It names the topic of this very question so it never sounds generic, and sounds engaged, but it states NO facts at all (no technologies, functions, files, numbers, prices, steps, results or what a line does), commits to nothing (no yes or no about plans, moving, skills or languages), never guesses, never asks the other person anything and does not try to answer.
- Openers must sound like a real person and vary every time. Never start with praise of the question ("Bra fråga", "Good question", "Godt spørgsmål", "Intressant fråga") or a stock word like "Absolut" or "Ja, det", and never start the way an earlier answer marked ${ANSWERED_TAG} started. Switch between ways in: name the topic and react ("Inloggningen – där fick jag tänka till ordentligt."), set the scene ("I examensarbetet stötte vi på precis det."), say why it matters to you ("Det är något jag brinner för, faktiskt."), think aloud ("Hur jag ser på ledarskap… låt mig ta ett konkret exempel."), or agree and lead on ("Ja, flytt har jag funderat mycket på.").
- Otherwise: `;
}

function shortSystemPrompt(style: AnswerStyle, language: LanguagePref, material: boolean): string {
  return `${INTRO}

If you have answered the user before, the transcript is split in two: the earlier conversation, where lines marked ${ANSWERED_TAG} show what you answered and when, and what was said after your last answer. The earlier part is context only.

Your task:
1. Find the most recent open question the user is expected to answer. It is usually the last question, asked by someone else. If the transcript is split, only look in the part said after your last answer. A question someone already answered fully is not open.
2. If there is no open question, pick the topic being discussed right now and give one smart, interesting remark the user can add. If the transcript is split, only do this when the part after your last answer brings up something new, not just reactions or someone repeating your answer.
3. Otherwise, or if the transcript contains nothing meaningful, use kind "none" and an empty answer.${material ? DEEP_STEP : ""}${liveStep(material ? 5 : 4)}

How to write "answer":
${openerRule(material ? '"deep" or "live"' : '"live"')}1-2 short sentences, at most ${SHORT_MAX_WORDS} words.
${COMMON_RULES}
- Style: ${STYLE_TEXT[style]}.
- Language: ${languageRule(language)}

Reply with JSON only, exactly in this shape:
{"kind":"question","question":"<the question or topic in at most 12 words>",${material ? '"deep":true,' : ""}"live":false,"answer":"<what the user should say>","lang":"<ISO 639-1 code of the answer language>"}
"kind" must be "question", "topic" or "none".`;
}

function materialIntro(searchable: boolean): string {
  return `Below the instructions is the user's prepared material: for example their CV, the job ad, documents such as a thesis or report with its references, and the source code of their projects, where every code line starts with its line number ("12| ").${
    searchable
      ? ` Documents marked "(visas bara delvis)" are too long to show whole: only their start or overview is here, and the ${SEARCH_TOOL} tool searches their full text word for word, every file, reference list and appendix included.`
      : ""
  } Together with what the app fetched from the internet just now (if anything), it is everything you know about the user. Read the parts that matter before you answer.`;
}

const SEARCH_TOOL = "search_material";

const SEARCH_RULE = `- Most of the documents marked "(visas bara delvis)" is not in this message. When the question asks for something specific (a person's name, a source or reference, where data came from, a number, a date, a result, a method detail, a file or function) and that exact detail is not written in this message, call ${SEARCH_TOOL} before you answer, even when you could answer in general terms: a vague answer ("a classmate", "an open dataset", "good results") is wrong when the exact detail may be in the hidden text, and so is going along with a vague opener. Search with precise words as they would be written in the material and in its language (for an English thesis for example "author", "dataset source", "references"), and when a search misses, search again with other words or a name you found. Only when the material and your searches show nothing, say so briefly and honestly in the user's voice (for example "Exakt den delen har jag inte framför mig, men…") and continue with what the material does show. Never fill the gap with generic talk.`;

const NO_SEARCH_RULE = `- If the material does not contain what is asked, say so briefly and honestly in the user's voice (for example "Exakt den delen har jag inte framför mig, men…") and continue with what the material does show. Never fill the gap with generic talk.`;

const NO_MATERIAL_INTRO = `The user has no prepared material for this. Answer from what the app fetched from the internet just now, your web search (if you have it) and reliable general knowledge.`;

const LIVE_RULES = `- The message may contain things fetched from the internet just now: websites mentioned in the conversation, the newest changes in the user's GitHub repos (commits, changed files, diffs) and the code of the repo a question is about, with line numbers. That code is the user's own: use it for questions about files, lines and how something is built, naming the file and the exact lines. They are newer than the prepared material: for anything that changed, trust them over the material. When asked what is new or what changed, answer from the commits and diffs concretely (what was added or fixed, in which part), in first person for the user's own repos.
- If a lookup failed or does not contain what is asked, use your web tools when you have them (open the page, or search the web); only if they fail too, say briefly and honestly that you cannot see it right now, in the user's voice, and continue with what you do know. Never guess what a page or a commit says.
- The user says your words to another person: never tell anyone to copy, paste, upload, open, send or check anything elsewhere (not even "kolla deras karriärsida"), and never mention the app or how you get information. If something cannot be read, only say that you cannot open it right now.`;

const WEB_SEARCH_RULE = `- You have a web search tool. Use it for anything current or beyond what you were given: news and headlines (also what is on a named site such as CNN right now), weather, prices, rates, results, opening hours, recent releases or events, a website that could not be read just now, and facts you are not sure of. Search precisely, for example "CNN top stories today" or "weather Aalborg today". For weather, use the place named in the conversation, otherwise the user's place from the profile or material, otherwise their approximate location.
- You can also open web pages with the web_fetch tool, by their full address (for example "https://picsum.photos/"). Asked what a website or page mentioned in the conversation says or shows: when it was not read just now, could not be read, shows almost nothing (pages built with JavaScript), or the question is about another page of that site (jobs and careers, prices, about, an article), open it: for another page, take the matching address from "Links on the page" (or from a page you opened) and open that page before you answer. Describe what is really there: what the site is, its main sections or items, headlines, prices or images, concretely. If opening fails, search the web for the site instead.
- When a question asks for facts the prepared material does not contain and that are not about the user's own life (the company or organization the user is meeting, its products, customers, news, numbers or values, a named product, technology, law or event), search the web instead of answering vaguely or saying you do not know. For a company, search its own website first (its name plus what is asked, for example "Netcompany cases public sector"), then news. Never search for what the material already answers, and never for the user's own life, projects or code.
- Asked to pick, summarize or comment on an article or news item: choose one concrete item from the results (when a connection to the user is asked for, one that really connects, such as technology, business, AI or education) and give its headline, what it is about and why it matters; when the profile or material allows, add how it connects to the user's own work, business or studies.
- After searching, still reply with only the JSON below and say the facts naturally, without links, source names or citation marks unless they matter. Say every headline and quote in the answer language, translated, never in the original English. Give the answer itself and stop: never end with advice such as "kolla gärna en färsk prognos innan du går ut" or "läs gärna artikeln", and never say what you could not open when you found the answer.`;

function deepSystemPrompt(style: AnswerStyle, language: LanguagePref, material: boolean, web: boolean, searchable: boolean): string {
  return `${INTRO}

The user just asked for help with the open question. They are already saying a short opener out loud (given in the message); right after it they will say your answer, so continue seamlessly from the opener without repeating it. Never comment on or correct the opener: if it got something wrong, just state the right facts.

${material ? materialIntro(searchable) : NO_MATERIAL_INTRO}

Strict rules:
- Answer the actual question concretely, in first person, as the user who did the work: name the real projects, files, classes, functions, tables, endpoints, libraries, employers, years and numbers that the material shows. For a question about specific code, find it and say what it really does, in words.
- Asked which code, file or line the user wrote or is proud of (also in general, like "on your GitHub" or a company or product name): you must pick it yourself from the numbered code in this message (lines that start with "12| ", not the list of newest changes), choosing real logic that shows skill rather than comments or markup, and say the file path, the exact line numbers ("rad 40 till 52") and what that code does and why. Every example you give gets its line numbers; when a file is shown only in part, pick code from the part that is shown. Saying that you do not have the files or line numbers in front of you is wrong whenever numbered code is in this message.
- Never invent anything the material and the lookups do not show: no facts, numbers, steps, colleagues, results or history. Never guess what code does without finding it.
${searchable ? SEARCH_RULE : NO_SEARCH_RULE}
- Never decide or promise anything for the user that the material does not state: moving, start date, salary, availability, plans to learn something, opinions. If the material says something related (for example where they live and want to work), answer honestly from that and keep the door open without inventing plans.
- Group projects: describe concretely what the project does from its code and say it was built in a group; claim personal contributions only where the material shows them. When the user's own part is not shown, talk about what "we" built, without saying that you cannot tell. Never disown a project the user listed.
- Never volunteer weaknesses, caveats or doubts nobody asked about, and never talk about how you would present something: just say it.
${LIVE_RULES}
${web ? WEB_SEARCH_RULE : "- You cannot open anything beyond what is in this message or come back later, so never say or imply that you will."}
- 2-5 sentences, at most ${DEEP_MAX_WORDS} words. Spoken language: no lists, no markdown, no code read out symbol by symbol. No filler, no flattery, never mention AI, documents, a CV or "the material".
- Style: ${STYLE_TEXT[style]}.
- Language: ${languageRule(language)}

Reply with JSON only, exactly in this shape:
{"question":"<the question you answered, at most 12 words>","answer":"<what the user says after the opener>","lang":"<ISO 639-1 code of the answer language>"}`;
}

function detailSystemPrompt(style: AnswerStyle, language: LanguagePref): string {
  return `${INTRO}

The user has just said a short answer out loud. Now they want a slightly longer explanation to continue with, for example if someone asks a follow-up question.

How to write "answer":
- 3-5 sentences, at most ${DETAIL_MAX_WORDS} words, that flow naturally after the short answer without repeating it word for word.
- Explain the why or how simply, and include one concrete example, number or surprising fact that makes the user sound genuinely knowledgeable.
${COMMON_RULES}
- Style: ${STYLE_TEXT[style]}.
- Language: ${languageRule(language)}

Reply with JSON only, exactly in this shape:
{"answer":"<what the user should say>","lang":"<ISO 639-1 code of the answer language>"}`;
}

function formatTranscript(lines: TranscriptLine[], answered: AnsweredItem[] = []): string {
  const entries = [
    ...lines,
    ...answered.map((a) => ({ secondsAgo: a.secondsAgo, text: `${ANSWERED_TAG} ${a.question} → ${a.answer}` })),
  ];
  if (entries.length === 0) return "(empty)";
  return entries
    .sort((a, b) => b.secondsAgo - a.secondsAgo)
    .map((e) => `[-${e.secondsAgo}s] ${e.text}`)
    .join("\n");
}

function words(list: string): RegExp {
  // \b treats å, ä and ö as word breaks, so whole words are matched with Unicode letter classes.
  return new RegExp(`(?<!\\p{L})(${list})(?!\\p{L})`, "giu");
}

/** Words that mostly occur in one of the three languages. */
const MARKERS: Record<LanguageCode, RegExp[]> = {
  sv: [
    words(
      "och|är|inte|hur|varför|vad|vill|också|någon|något|skulle|kanske|mycket|jobba|jobbar|berätta|tycker|kör|känner|" +
        "jag|vilka|vilken|vilket|vem|enligt|från|när|ni|ditt|dina|mitt|hittade|krediterade",
    ),
    /[äö]/giu,
  ],
  // Not "er": it is Danish for "is" but also Swedish ("er modell").
  da: [words("og|ikke|hvordan|hvorfor|hvad|vil|også|nogen|noget|meget|fortæl|synes|arbejder|arbejde|jeg|hvilke|hvilken|hvem|ifølge|fra"), /[æø]/giu],
  en: [words("the|and|is|are|what|why|how|you|your|would|about|with|have|tell|do|does|so")],
};

/** The language of the latest lines, if it is clear. */
function conversationLanguage(lines: TranscriptLine[]): LanguageCode | null {
  const text = lines
    .slice(-3)
    .map((l) => l.text)
    .join(" ");
  const scores = (Object.keys(MARKERS) as LanguageCode[])
    .map((code) => [code, MARKERS[code].reduce((n, re) => n + (text.match(re)?.length ?? 0), 0)] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 1 && best[1] >= second[1] * 2 ? best[0] : null;
}

function userPrompt(req: AnswerRequest, live = ""): string {
  const parts = [`Today's date: ${new Date().toISOString().slice(0, 10)}`];
  const spoken = req.language === "auto" ? conversationLanguage(req.transcript) : null;
  if (spoken) {
    parts.push(`The conversation is in ${LANGUAGE_NAME[spoken]}, so write the answer in ${LANGUAGE_NAME[spoken]}.`);
  } else if (req.context && req.language === "auto") {
    parts.push("Answer in the language the latest question was asked in, even if the prepared material is in another language.");
  }
  if (req.profile) parts.push(`About the user (use only when relevant): ${req.profile}`);
  const answered = req.mode === "short" ? (req.answered ?? []) : [];
  if (answered.length > 0) {
    const lastAnswer = Math.min(...answered.map((a) => a.secondsAgo));
    const earlier = req.transcript.filter((l) => l.secondsAgo >= lastAnswer);
    const after = req.transcript.filter((l) => l.secondsAgo < lastAnswer);
    parts.push(`Earlier conversation, oldest first (context only):\n${formatTranscript(earlier, answered)}`);
    parts.push(`Said after your last answer, oldest first:\n${after.length > 0 ? formatTranscript(after) : "(nothing yet)"}`);
    const starts = answered.map((a) => a.answer.split(/\s+/).slice(0, 4).join(" ")).filter(Boolean);
    if (starts.length) parts.push(`Your earlier answers started with: ${starts.map((s) => `"${s}…"`).join(", ")}. Start this one differently.`);
  } else {
    parts.push(`Live transcript, oldest first:\n${formatTranscript(req.transcript)}`);
  }
  if (req.mode === "detail") {
    parts.push(`Question or topic: ${req.question || "(see transcript)"}`);
    parts.push(`Short answer the user already said: ${req.shortAnswer || "(none)"}`);
  } else if (req.mode === "deep") {
    parts.push(`Question or topic: ${req.question || "(the latest open question in the transcript)"}`);
    parts.push(
      `Opener the user is saying right now: ${req.shortAnswer || "(written at the same time as your answer, so you do not know it: a short sentence that only names the topic; start directly with the substance)"}`,
    );
  }
  if (req.snippets) {
    parts.push(
      `Parts of the user's material (documents and code) that match what is being talked about (use them when the question is about them, otherwise ignore them):\n${req.snippets}`,
    );
  }
  if (live) {
    parts.push(`FETCHED FROM THE INTERNET JUST NOW (${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC; use it when it matters for the question):\n${live}\n(End of what was fetched.)`);
  }
  if (req.language !== "auto") {
    // Material in another language (e.g. Danish code comments) must not pull the answer along.
    parts.push(`Write the answer in ${LANGUAGE_NAME[req.language]}.`);
  } else if (spoken && (req.snippets || req.context)) {
    parts.push(`Write the answer in ${LANGUAGE_NAME[spoken]}.`);
  }
  return parts.join("\n\n");
}

export function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const attempts = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) attempts.push(cleaned.slice(start, end + 1));
  for (const candidate of attempts) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function cleanSpoken(text: string): string {
  return text
    // add_target_and_features reads and sounds like "add target and features".
    .replace(/(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}])/gu, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”„«»]+|["'“”„«»]+$/g, "")
    .trim()
    .slice(0, 1200);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeLang(value: unknown, fallback: string): string {
  const code = asString(value).toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : fallback;
}

const SAFE_OPENERS: Record<string, string[]> = {
  sv: [
    "Det kan jag gärna berätta om.",
    "Det där har jag en del tankar kring.",
    "Låt mig ta det från början.",
    "Det är något jag har funderat en del på.",
    "Där har jag faktiskt ett bra exempel.",
    "Okej, låt mig förklara hur jag tänker.",
  ],
  da: [
    "Det fortæller jeg gerne om.",
    "Det har jeg en del tanker om.",
    "Lad mig tage det fra begyndelsen.",
    "Det er noget, jeg har tænkt en del over.",
    "Der har jeg faktisk et godt eksempel.",
    "Okay, lad mig forklare, hvordan jeg tænker.",
  ],
  en: [
    "Happy to go into that.",
    "I've got a few thoughts on that.",
    "Let me take that from the start.",
    "That's something I've thought about quite a bit.",
    "I actually have a good example of that.",
    "Okay, let me walk you through how I think about it.",
  ],
};
/** The model often runs a little past the asked length; well past it, the opener has started answering. */
const OPENER_HARD_MAX_WORDS = 24;

function safeOpener(lang: string): string {
  const options = SAFE_OPENERS[lang] ?? SAFE_OPENERS.en;
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * An opener that runs long has usually started answering, and its details are guesses the deep
 * answer may contradict: keep the first sentence if it is short, otherwise a neutral opener.
 */
function trimOpener(answer: string, lang: string): string {
  const count = (s: string) => s.split(/\s+/).filter(Boolean).length;
  if (count(answer) <= OPENER_HARD_MAX_WORDS) return answer;
  const first = answer.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? "";
  if (first && count(first) <= OPENER_HARD_MAX_WORDS) return first;
  return safeOpener(lang);
}

const PRAISE =
  /^(?:(?:mm+|ja|okej|okay|oh|åh|nå)[,!.…]?\s+)?(?:en |a |et )?(?:riktigt |väldigt |really |very |rigtig |meget )?(?:bra|god|grym|intressant|spännande|rolig|good|great|interesting|excellent|fair|godt|interessant|spændende|fedt)\s+(?:fråga|question|spørgsmål)\b[\s,.!–—:-]*/iu;

/** "Bra fråga, …" in front of every answer sounds canned; the rest of the sentence stands alone. */
function dropPraise(answer: string, lang: string): string {
  const rest = answer.replace(PRAISE, "");
  if (rest === answer) return answer;
  if (rest.split(/\s+/).filter(Boolean).length < 3) return safeOpener(lang);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function mockAnswer(req: AnswerRequest): Omit<AnswerResult, "model" | "ms"> {
  const last = req.transcript.at(-1)?.text ?? "";
  if (req.mode !== "short") {
    return {
      kind: "question",
      question: req.question ?? "",
      answer:
        "(Testläge) Det här är den längre förklaringen. Med en riktig API-nyckel får du här tre till fem meningar med ett konkret exempel som gör att du låter påläst.",
      lang: "sv",
    };
  }
  const newestAnswered = Math.min(...(req.answered ?? []).map((a) => a.secondsAgo));
  const lastSecondsAgo = req.transcript.at(-1)?.secondsAgo ?? 0;
  if (!last || lastSecondsAgo >= newestAnswered) return { kind: "none", question: "", answer: "", lang: "sv" };
  const isQuestion = last.includes("?");
  return {
    kind: isQuestion ? "question" : "topic",
    question: last.slice(0, 80),
    answer: isQuestion
      ? "(Testläge) Här kommer ett kort och smart svar på frågan."
      : "(Testläge) Här kommer en smart kommentar om ämnet.",
    lang: "sv",
  };
}

const SEARCH_RESULT_CHARS = 9_000;

/**
 * The material as search documents: the full texts of the documents shown only in part, and the
 * rest of the context (with the line numbers it got for the model taken off again).
 */
function searchDocs(req: AnswerRequest): SearchDoc[] {
  const docs: SearchDoc[] = [...(req.library ?? [])];
  const parts = (req.context ?? "").split(/\n\n=== (.+?) ===\n/);
  if (parts[0]?.trim()) docs.push({ name: "Förberedelsen", text: parts[0] });
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if (parts[i].endsWith("(visas bara delvis)")) continue;
    const text = parts[i + 1].includes(FILE_MARK) ? parts[i + 1].replace(/^\d+\| /gm, "") : parts[i + 1];
    docs.push({ name: parts[i], text });
  }
  return docs;
}

function materialSearchTool(req: AnswerRequest): LocalTool {
  const docs = searchDocs(req);
  return {
    name: SEARCH_TOOL,
    description:
      "Searches ALL of the user's prepared material word for word: every document in full (theses, reports with their references and appendices, CV, notes) and every file of their code projects (readme, docs, scripts, code with line numbers). Use it whenever something asked is not shown in the message. Write the query with the precise words the material would use, in the material's language (an English thesis: English words), for example names, terms, file names or 'dataset source references'. Returns the best matching passages with document, file and line numbers, or says that nothing matched.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to search for." } },
      required: ["query"],
    },
    run(input) {
      const query = typeof input.query === "string" ? input.query.slice(0, 300) : "";
      const hits = searchMaterial(docs, query, SEARCH_RESULT_CHARS);
      console.log(`[psst] material search: ${query.split(/\s+/).filter(Boolean).length} words, ${hits.length} chars found`);
      return hits || "Nothing in the material matches these words. Try other words (synonyms, a name, the material's language) before concluding it is not there.";
    },
  };
}

export async function generateAnswer(
  cfg: LlmConfig,
  req: AnswerRequest,
  signal: AbortSignal,
  /** ISO country code of where the request comes from (Cloudflare), for weather and local news. */
  country?: string,
): Promise<AnswerResult> {
  const started = Date.now();
  const fallbackLang = req.language === "auto" ? "sv" : req.language;

  if (cfg.provider === "mock") {
    await new Promise((r) => setTimeout(r, 600));
    return { ...mockAnswer(req), model: "mock", ms: Date.now() - started };
  }

  const isDeep = req.mode === "deep";
  const isDetail = req.mode === "detail" || isDeep;
  // Every deep answer can search the web for facts beyond the material; "live" ones must.
  const web = isDeep && cfg.provider === "anthropic";
  // The short answer must come at once; only the answers that follow it wait for the internet.
  const live = isDetail ? await liveLookups(req, signal) : "";
  const search = isDeep && cfg.provider === "anthropic" && req.library?.length ? materialSearchTool(req) : null;
  // Nothing was fetched, so only a search can answer; otherwise the model sometimes just promises to look.
  const mustSearch = web && !!req.live && !/just now\b[^\n]*:\n/.test(live);
  const user = [
    userPrompt(req, live),
    web && country ? `The user's approximate location: country ${country}.` : "",
    mustSearch
      ? "This question needs facts from the internet that nothing above contains: open the page or search the web before you answer."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await chat(cfg, {
    system: isDeep
      ? deepSystemPrompt(req.style, req.language, !!req.context, web, !!search)
      : isDetail
        ? detailSystemPrompt(req.style, req.language)
        : shortSystemPrompt(req.style, req.language, !!req.context),
    context: req.context ? contextBlock(req.context) : undefined,
    user,
    // Generous because reasoning tokens (when a model insists on them) count towards the limit.
    maxTokens: isDetail ? 1200 : 800,
    temperature: 0.5,
    json: true,
    signal,
    // Each search adds about 20K tokens of results; two let it find a page and then look closer.
    webSearches: web ? 2 : undefined,
    // Two let it open a page and then the link on it that answers the question.
    webFetches: web ? 2 : undefined,
    webCountry: web ? country : undefined,
    mustSearch,
    localTools: search ? [search] : undefined,
    maxToolRounds: 3,
  });

  // After a web search the model sometimes marks its sources as <cite index="…">…</cite> in the text.
  const reply = raw.replace(/<\/?cite\b(?:[^>"]|"[^"]*")*>/g, "");
  const parsed = parseJsonLoose(reply);
  let kind: AnswerKind;
  let question: string;
  let answer: string;
  let lang: string;
  let deep = false;
  let needsLookup = false;

  if (parsed) {
    needsLookup = !isDetail && parsed.live === true;
    deep = !isDetail && ((!!req.context && parsed.deep === true) || needsLookup);
    answer = cleanSpoken(asString(parsed.answer));
    question = cleanSpoken(asString(parsed.question)).slice(0, 200);
    lang = normalizeLang(parsed.lang, fallbackLang);
    const k = asString(parsed.kind);
    kind = isDetail ? "question" : k === "topic" || k === "none" ? k : "question";
  } else {
    // The model ignored the JSON format; treat the whole reply as the answer.
    answer = cleanSpoken(reply);
    question = "";
    lang = fallbackLang;
    kind = "question";
  }

  if (isDetail) question = req.question || question;
  if (!answer) {
    if (isDetail) throw new AppError(502, "provider_error", "Modellen gav ingen förklaring.");
    kind = "none";
  }
  if (kind === "none") {
    answer = "";
    deep = false;
    needsLookup = false;
  }
  if (deep) answer = trimOpener(answer, lang);
  if (!isDetail && answer) answer = dropPraise(answer, lang);
  if (req.language !== "auto" && (LANGUAGE_CODES as readonly string[]).includes(req.language)) {
    lang = req.language;
  }

  return {
    kind,
    question,
    answer,
    ...(deep ? { deep } : {}),
    ...(needsLookup ? { live: true } : {}),
    lang,
    model: cfg.model,
    ms: Date.now() - started,
  };
}
