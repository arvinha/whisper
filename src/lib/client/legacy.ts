import { adoptLegacyMemory } from "./memory";
import { currentOwner, LEGACY_OWNER, legacyTaken, PERSONAL_KEYS, PROFILE_KEY } from "./owner";

/** What the phone kept before things belonged to an account, so its owner can recognize it. */
export interface LegacyPreview {
  prepTitles: string[];
  preps: number;
  summaries: number;
  agenda: number;
  profile: boolean;
}

function legacyRaw(base: string): string | null {
  try {
    return window.localStorage.getItem(`${base}@${LEGACY_OWNER}`);
  } catch {
    return null;
  }
}

function parse(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function count(base: string): number {
  const list = parse(legacyRaw(base));
  return Array.isArray(list) ? list.length : 0;
}

export function legacyPreview(): LegacyPreview {
  const state = parse(legacyRaw("psst.preps.v1")) as { preps?: Array<{ title?: string }> } | null;
  const preps = Array.isArray(state?.preps) ? state.preps : [];
  return {
    prepTitles: preps.map((p) => (typeof p.title === "string" ? p.title.trim() : "")).filter(Boolean).slice(0, 4),
    preps: preps.length,
    summaries: count("psst.summaries.v1"),
    agenda: count("psst.agenda.v1"),
    profile: !!legacyRaw(PROFILE_KEY)?.trim(),
  };
}

function idOf(item: unknown): string {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : JSON.stringify(item);
}

/** Puts the two together without doubles; for the transcript and profile, the person's own wins. */
function merged(base: string, mine: string | null, old: string): string {
  if (base === "psst.preps.v1") {
    const a = (parse(mine) ?? { preps: [], activeId: null }) as { preps: unknown[]; activeId: string | null };
    const b = (parse(old) ?? { preps: [], activeId: null }) as { preps: unknown[]; activeId: string | null };
    const ids = new Set(a.preps.map(idOf));
    return JSON.stringify({ preps: [...a.preps, ...b.preps.filter((p) => !ids.has(idOf(p)))], activeId: a.activeId ?? b.activeId });
  }
  const a = parse(mine);
  const b = parse(old);
  if (Array.isArray(a) && Array.isArray(b)) {
    const ids = new Set(a.map(idOf));
    return JSON.stringify([...a, ...b.filter((x) => !ids.has(idOf(x)))]);
  }
  return mine?.trim() ? mine : old;
}

/** "Yes, it is mine": everything from before moves into the signed-in person's own storage. */
export async function claimLegacy(): Promise<void> {
  const who = currentOwner();
  if (!who) return;
  for (const base of [...PERSONAL_KEYS, PROFILE_KEY]) {
    const old = legacyRaw(base);
    if (old === null) continue;
    const key = `${base}@${who}`;
    try {
      window.localStorage.setItem(key, merged(base, window.localStorage.getItem(key), old));
    } catch {
      // storage full: leave it where it was
      return;
    }
  }
  await adoptLegacyMemory().catch(() => {});
  legacyTaken();
}
