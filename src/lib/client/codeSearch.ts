import { FILE_MARK, searchMaterial } from "@/lib/shared/materialSearch";
import type { Prep, PrepDoc } from "./preps";

export { FILE_MARK };

/**
 * The parts of the user's material (documents, theses, references and every file of their code
 * projects) that best match what is being said, for one answer. Plain word matching with spoken-word
 * synonyms is fast enough to run on every question. `only` limits the search to some documents.
 */
export function materialSnippets(prep: Prep | null, query: string, maxChars: number, only?: (doc: PrepDoc) => boolean): string {
  if (!prep || maxChars <= 0) return "";
  const docs = prep.docs.filter((d) => d.text.trim() && (!only || only(d))).map((d) => ({ name: d.name, text: d.text }));
  return searchMaterial(docs, query, maxChars);
}

/** Readme, build files and file tree: the start of a code document. */
export function codeOverview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return `${text.slice(0, cut > maxChars / 2 ? cut : maxChars)}\n… (fler filer finns; de som passar frågan skickas med)`;
}
