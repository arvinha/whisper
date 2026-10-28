import { useSyncExternalStore } from "react";

/**
 * Whose things the phone shows. Every account and every personal code has its own preps, profile,
 * memory, notes and agenda on the phone, so someone who borrows the phone with their own account
 * never sees them. `null` means nobody is signed in: nothing personal is read or saved.
 */

const OWNER_KEY = "psst.owner.v1";
const MIGRATED_KEY = "psst.scoped.v1";
const LEGACY_PENDING_KEY = "psst.legacy.pending";
const LEGACY_DISMISSED_KEY = "psst.legacy.dismissed";
/** Things saved before they belonged to anyone, waiting for their owner to take them. */
export const LEGACY_OWNER = "legacy";
/** The keys that were saved for the whole phone before; settings keep only the profile apart. */
export const PERSONAL_KEYS = [
  "psst.preps.v1",
  "psst.summaries.v1",
  "psst.agenda.v1",
  "psst.inbox.v1",
  "psst.inbox.dismissed.v1",
  "psst.transcript.v1",
] as const;
export const PROFILE_KEY = "psst.profile.v1";
const SETTINGS_KEY = "psst.settings.v1";

let owner: string | null = null;
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private mode or storage full
  }
}

/** Once: moves what was saved for the whole phone aside, so nobody gets it without saying it is theirs. */
function migrate() {
  if (read(MIGRATED_KEY)) return;
  let found = false;
  for (const key of PERSONAL_KEYS) {
    const value = read(key);
    if (value === null) continue;
    write(`${key}@${LEGACY_OWNER}`, value);
    write(key, null);
    found = true;
  }
  const settings = read(SETTINGS_KEY);
  if (settings) {
    // The app was used before, so the memory database may hold what was heard.
    found = true;
    try {
      const parsed = JSON.parse(settings) as Record<string, unknown>;
      if (typeof parsed.profile === "string" && parsed.profile.trim()) write(`${PROFILE_KEY}@${LEGACY_OWNER}`, parsed.profile);
      delete parsed.profile;
      write(SETTINGS_KEY, JSON.stringify(parsed));
    } catch {
      // unreadable settings start over anyway
    }
  }
  if (found) write(LEGACY_PENDING_KEY, "1");
  write(MIGRATED_KEY, "1");
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  migrate();
  owner = read(OWNER_KEY) || null;
}

export function currentOwner(): string | null {
  load();
  return owner;
}

/** The phone's storage key for the signed-in person, or null when nobody is. */
export function ownedKey(base: string): string | null {
  const who = currentOwner();
  return who ? `${base}@${who}` : null;
}

export function onOwnerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Who a config belongs to: the account, the personal code, or the main password. */
export function ownerOf(config: { authorized: boolean; user: string; account: { email: string } | null }): string | null {
  if (!config.authorized) return null;
  if (config.account) return `a${hash(config.account.email.trim().toLowerCase())}`;
  if (config.user) return `c${hash(config.user)}`;
  return "main";
}

export function setOwner(next: string | null) {
  load();
  if (next === owner) return;
  owner = next;
  write(OWNER_KEY, next);
  notify();
}

// ---- things from before ---------------------------------------------------------------------------

/** Whether the signed-in person should be asked if the things saved before are theirs. */
export function legacyWaiting(): boolean {
  const who = currentOwner();
  if (!who || read(LEGACY_PENDING_KEY) !== "1") return false;
  const dismissed = (read(LEGACY_DISMISSED_KEY) ?? "").split(",");
  return !dismissed.includes(who);
}

/** "Not mine": this person is not asked again; the things stay for whoever they belong to. */
export function dismissLegacy() {
  const who = currentOwner();
  if (!who) return;
  const dismissed = (read(LEGACY_DISMISSED_KEY) ?? "").split(",").filter(Boolean);
  write(LEGACY_DISMISSED_KEY, [...dismissed, who].join(","));
  notify();
}

/** The things from before are gone (taken by their owner). */
export function legacyTaken() {
  write(LEGACY_PENDING_KEY, null);
  write(LEGACY_DISMISSED_KEY, null);
  for (const key of [...PERSONAL_KEYS, PROFILE_KEY]) write(`${key}@${LEGACY_OWNER}`, null);
  notify();
}

/** Re-renders when the owner or the things from before change. */
export function useOwnerVersion(): number {
  return useSyncExternalStore(
    onOwnerChange,
    () => version,
    () => 0,
  );
}
