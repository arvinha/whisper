import { inflateRawSync } from "node:zlib";
import type { ExtractResult } from "@/lib/shared/types";
import type { LlmConfig } from "./config";
import { codeDigest, isCodeFileName, singleFileDigest, zipFiles } from "./code";
import { AppError } from "./errors";
import { chat } from "./llm";

export const MAX_FILE_BYTES = 4_200_000;
/** A zipped project; the code inside is what matters, and it is read without the AI model. */
export const MAX_ZIP_BYTES = 25_000_000;
/** About 25 pages of dense text; longer documents are cut. */
export const MAX_EXTRACT_CHARS = 80_000;
const MAX_UNZIPPED_BYTES = 40_000_000;
/** Below this many letters per page, a PDF is probably scanned and needs the model to read it. */
const SCANNED_CHARS_PER_PAGE = 40;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const TEXT_EXTENSIONS = ["txt", "md", "markdown", "csv", "tsv", "json", "rtf", "html", "htm", "xml", "srt", "vtt"];

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Buffer;
}

function extension(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- zip (docx, pptx, odt) -------------------------------------------------------------------

/** Reads the entries of a zip file. Office files are zip archives of XML. */
export function readZip(buf: Buffer): Map<string, () => Buffer> {
  const entries = new Map<string, () => Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AppError(400, "bad_request", "Filen verkar trasig (ingen giltig zip).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let unzipped = 0;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    entries.set(name, () => {
      if (localOffset + 30 > buf.length) return Buffer.alloc(0);
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const data = buf.subarray(start, start + compressedSize);
      const room = MAX_UNZIPPED_BYTES - unzipped;
      if (room <= 0) return Buffer.alloc(0);
      let out: Buffer;
      try {
        out = method === 0 ? data.subarray(0, room) : method === 8 ? inflateRawSync(data, { maxOutputLength: room }) : Buffer.alloc(0);
      } catch {
        out = Buffer.alloc(0);
      }
      unzipped += out.length;
      return out;
    });
  }
  return entries;
}

function wordXmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:(br|cr)\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function drawingXmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<a:br\/>/g, "\n")
      .replace(/<\/a:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function numbered(entries: Map<string, () => Buffer>, pattern: RegExp): Array<[number, () => Buffer]> {
  return [...entries]
    .map(([name, read]) => [Number(pattern.exec(name)?.[1] ?? NaN), read] as [number, () => Buffer])
    .filter(([n]) => Number.isFinite(n))
    .sort((a, b) => a[0] - b[0]);
}

function readDocx(buf: Buffer): string {
  const entries = readZip(buf);
  const main = entries.get("word/document.xml");
  if (!main) throw new AppError(400, "bad_request", "Hittade ingen text i Word-filen.");
  return wordXmlToText(main().toString("utf8"));
}

function readPptx(buf: Buffer): string {
  const entries = readZip(buf);
  const slides = numbered(entries, /^ppt\/slides\/slide(\d+)\.xml$/);
  const notes = new Map(numbered(entries, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/));
  if (slides.length === 0) throw new AppError(400, "bad_request", "Hittade inga bilder i PowerPoint-filen.");
  return slides
    .map(([n, read]) => {
      const text = tidy(drawingXmlToText(read().toString("utf8")));
      // Speaker notes start with the slide number placeholder; drop a lone number.
      const note = notes.get(n);
      const noteText = note ? tidy(drawingXmlToText(note().toString("utf8"))).replace(/^\d+$/m, "").trim() : "";
      return `Bild ${n}:\n${text}${noteText ? `\nTalaranteckningar: ${noteText}` : ""}`;
    })
    .join("\n\n");
}

function readOdt(buf: Buffer): string {
  const content = readZip(buf).get("content.xml");
  if (!content) throw new AppError(400, "bad_request", "Hittade ingen text i filen.");
  return decodeEntities(
    content()
      .toString("utf8")
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<\/text:(p|h)>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

// ---- text-like files -------------------------------------------------------------------------

function readRtf(raw: string): string {
  return raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

export function readHtml(raw: string): string {
  return decodeEntities(
    raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function readTextFile(buf: Buffer, ext: string): string {
  const raw = buf.toString("utf8").replace(/^\uFEFF/, "");
  if (ext === "rtf") return readRtf(raw);
  if (ext === "html" || ext === "htm") return readHtml(raw);
  return raw;
}

// ---- pdf and images --------------------------------------------------------------------------

async function readPdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText } = await import("unpdf");
  try {
    const { totalPages, text } = await extractText(new Uint8Array(buf), { mergePages: false });
    const pages = text.map((t) => tidy(t));
    const body = pages.length > 1 ? pages.map((t, i) => `Sida ${i + 1}:\n${t}`).join("\n\n") : (pages[0] ?? "");
    return { text: body, pages: totalPages };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/password/i.test(message)) {
      throw new AppError(400, "bad_request", "PDF:en är lösenordsskyddad. Spara en kopia utan lösenord.");
    }
    throw new AppError(400, "bad_request", "Kunde inte läsa PDF:en. Prova att spara om den eller klistra in texten.");
  }
}

const READ_PROMPT = `You read files for "Aivia" in the app "Whisper", an assistant that helps the user in interviews, meetings and presentations. Write out all text in the file faithfully and completely, in its original language, keeping headings, lists and the reading order with plain line breaks. Do not summarize or translate. Only if the file is mostly a photo, chart or diagram with little text, add one or two sentences describing what it shows, in the same language as the text in it (Swedish if there is none). Plain text only, no markdown, no comments of your own.`;

async function readWithModel(cfg: LlmConfig, file: UploadedFile, mediaType: string, signal: AbortSignal): Promise<string> {
  if (cfg.provider === "mock") return `(Testläge) Text från ${file.name}.`;
  return chat(cfg, {
    system: READ_PROMPT,
    user: `File name: ${file.name}`,
    attachments: [{ mediaType, data: file.bytes.toString("base64"), name: file.name }],
    maxTokens: 12_000,
    temperature: 0,
    json: false,
    signal,
  });
}

function imageType(file: UploadedFile): string | null {
  if (IMAGE_TYPES.includes(file.type)) return file.type;
  const ext = extension(file.name);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png" || ext === "webp" || ext === "gif") return `image/${ext}`;
  return null;
}

/** Turns an uploaded file into plain text. */
export async function extractFile(
  file: UploadedFile,
  vision: LlmConfig | null,
  signal: AbortSignal,
): Promise<ExtractResult> {
  const ext = extension(file.name);
  const needVision = () => {
    if (!vision) {
      throw new AppError(
        400,
        "bad_request",
        "Bilder och skannade PDF:er kräver en Claude- eller OpenAI-nyckel på servern. Klistra in texten i stället.",
      );
    }
    return vision;
  };

  let text: string;
  let method: ExtractResult["method"] = "text";
  let pages: number | undefined;

  if (ext === "zip" || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
    const title = file.name.replace(/\.zip$/i, "") || "Projekt";
    const digest = codeDigest(title, zipFiles(file.bytes), [`Uppladdad fil: ${file.name}`]);
    return { name: title, text: digest.text, method, truncated: digest.truncated, kind: "code" };
  }
  if (!TEXT_EXTENSIONS.includes(ext) && isCodeFileName(file.name)) {
    return { name: file.name, text: singleFileDigest(file.name, file.bytes), method, truncated: false, kind: "code" };
  }

  if (file.type === "application/pdf" || ext === "pdf") {
    const pdf = await readPdfText(file.bytes);
    pages = pdf.pages;
    text = pdf.text;
    if (text.replace(/\s/g, "").length < SCANNED_CHARS_PER_PAGE * Math.max(1, pages)) {
      text = await readWithModel(needVision(), file, "application/pdf", signal);
      method = "ai";
    }
  } else if (ext === "docx" || ext === "docm" || ext === "dotx") {
    text = readDocx(file.bytes);
  } else if (ext === "pptx" || ext === "ppsx" || ext === "potx") {
    text = readPptx(file.bytes);
  } else if (ext === "odt" || ext === "odp") {
    text = readOdt(file.bytes);
  } else if (imageType(file)) {
    text = await readWithModel(needVision(), file, imageType(file)!, signal);
    method = "ai";
  } else if (file.type.startsWith("text/") || TEXT_EXTENSIONS.includes(ext)) {
    text = readTextFile(file.bytes, ext);
  } else if (ext === "doc" || ext === "ppt" || ext === "pages" || ext === "key") {
    throw new AppError(
      400,
      "bad_request",
      "Det filformatet går inte att läsa. Spara eller exportera filen som PDF och ladda upp den igen.",
    );
  } else if (ext === "heic" || ext === "heif") {
    throw new AppError(400, "bad_request", "HEIC-bilder går inte att läsa. Ta en skärmdump eller välj bilden via Bilder.");
  } else {
    throw new AppError(
      400,
      "bad_request",
      `Kan inte läsa .${ext || "okänd"}-filer. Använd PDF, Word, PowerPoint, text, bild, kodfiler eller en zip med ditt projekt.`,
    );
  }

  text = tidy(text);
  if (!text) throw new AppError(400, "bad_request", "Hittade ingen text i filen.");
  const truncated = text.length > MAX_EXTRACT_CHARS;
  return { name: file.name, text: truncated ? text.slice(0, MAX_EXTRACT_CHARS) : text, method, pages, truncated, kind: "doc" };
}
