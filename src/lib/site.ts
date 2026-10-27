import type { UiLang } from "@/lib/i18n";

/** Public address used in canonical links, the sitemap and social previews. */
export const SITE_URL = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "") || "https://whisper.teknikfix.dk";

export const LANDING_PATHS: Record<UiLang, string> = { sv: "/sv", da: "/da", en: "/en" };

export const LANDING_LANGS: Record<string, string> = {
  "sv-SE": LANDING_PATHS.sv,
  "da-DK": LANDING_PATHS.da,
  en: LANDING_PATHS.en,
  "x-default": LANDING_PATHS.sv,
};
