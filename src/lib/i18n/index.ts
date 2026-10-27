import { da } from "./da";
import { en } from "./en";
import { sv, type Dict } from "./sv";

export type UiLang = "sv" | "da" | "en";
export type { Dict };

export const DICTS: Record<UiLang, Dict> = { sv, da, en };

export const UI_LANG_NAMES: Record<UiLang, string> = { sv: "Svenska", da: "Dansk", en: "English" };
