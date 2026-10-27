/**
 * Whisper-style models invent text for silence and noise, usually phrases from subtitled videos.
 * These patterns remove the most common ones in Swedish, Danish and English.
 */
const HALLUCINATIONS: RegExp[] = [
  /tack för att (du|ni) (har )?(tittat|tittade|kollade|lyssnade|lyssnat)/i,
  /undertext(er|ning)?\s+(från|av)\b/i,
  /svensktextning|textning\.nu|svensk medietext|^text(ning)?:\s/i,
  /\bamara\.org\b/i,
  /prenumerera på (min|vår|kanalen)/i,
  /tak fordi (du|i) (så|kiggede|lyttede) med/i,
  /tak for at (se|lytte) med/i,
  /undertekst(er)? (af|fra)\b/i,
  /^(danske )?tekster( af|:)/i,
  /thanks? (you )?for watching/i,
  /please (like and )?subscribe/i,
  /subtitles? (by|from)\b/i,
  /transcribed by|transcription by/i,
  /www\.\w+\.(com|se|dk|org)/i,
];

const SHORT_ONLY_IF_SPEECH = /^(tack|tak|thank you|thanks|you|bye|hej då|okej|mm+|hmm+)[.!]?$/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses long runs of the same word or phrase ("ja ja ja ja ja ja"). */
function collapseRepeats(text: string): string {
  return text.replace(/(\b[\p{L}\p{N}' ]{1,40}?)(?:[\s,.]+\1){3,}/giu, "$1");
}

export function cleanTranscript(raw: string, speechMs: number): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  text = text.replace(/[\[(](musik|music|applåder|applause|skratt|laughter|tystnad|silence)[\])]/gi, "").trim();
  if (/^[\s\p{P}\p{S}♪]*$/u.test(text)) return null;
  if (HALLUCINATIONS.some((re) => re.test(text))) return null;
  if (speechMs < 600 && SHORT_ONLY_IF_SPEECH.test(text)) return null;
  text = collapseRepeats(text);
  return text || null;
}

/** Word overlap between a transcript and text we just spoke, to drop our own voice picked up by the mic. */
export function similarity(a: string, b: string): number {
  const wa = normalize(a).split(" ").filter(Boolean);
  const wb = new Set(normalize(b).split(" ").filter(Boolean));
  if (wa.length === 0 || wb.size === 0) return 0;
  const hits = wa.filter((w) => wb.has(w)).length;
  return hits / wa.length;
}

const QUESTION_START =
  /^(vad|vem|vems|var|vart|varifrån|när|varför|hur|vilken|vilket|vilka|kan|kommer|är|har|ska|skulle|vill|tror|vet|minns|hvad|hvem|hvis|hvor|hvorfor|hvordan|hvornår|hvilken|hvilket|hvilke|er|skal|ville|ved|husker|what|who|whose|where|when|why|how|which|can|could|do|does|did|is|are|was|were|will|would|should|have|has|any)\b/i;

const QUESTION_INSIDE =
  /\b(vad tror du|vad tycker du|vet du|har du hört|kan du förklara|hvad synes du|ved du|hvad tror du|what do you think|do you know|have you heard|can you explain)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.includes("?")) return true;
  const lastSentence = t.split(/[.!]\s+/).pop() ?? t;
  return QUESTION_START.test(lastSentence.trim()) || QUESTION_INSIDE.test(t);
}

export function wordCount(text: string): number {
  return normalize(text).split(" ").filter(Boolean).length;
}
