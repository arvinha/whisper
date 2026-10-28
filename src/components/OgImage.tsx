import { ImageResponse } from "next/og";
import { BrandIcon } from "@/components/BrandIcon";
import type { UiLang } from "@/lib/i18n";

export const OG_SIZE = { width: 1200, height: 630 };

export const OG_TEXT: Record<UiLang, { alt: string; tagline: string; uses: string }> = {
  sv: {
    alt: "Whisper, AI-assistent för samtal",
    tagline: "Din AI-assistent i varje samtal",
    uses: "Möten · Redovisningar · Plugg · 20 min gratis",
  },
  da: {
    alt: "Whisper, AI-assistent til samtaler",
    tagline: "Din AI-assistent i hver samtale",
    uses: "Møder · Fremlæggelser · Studier · 20 min. gratis",
  },
  en: {
    alt: "Whisper, an AI assistant for conversations",
    tagline: "Your AI assistant for every conversation",
    uses: "Meetings · Presentations · Notes · 20 min free",
  },
};

export function ogImage(lang: UiLang) {
  const text = OG_TEXT[lang];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 60,
          padding: "0 90px",
          background: "radial-gradient(circle at 25% 40%, #2a2140 0%, #07070a 65%)",
          color: "#f4f4f5",
        }}
      >
        <div style={{ width: 300, height: 300, display: "flex", borderRadius: 9999, overflow: "hidden" }}>
          <BrandIcon size={300} ring />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
            whis<span style={{ color: "#c4b5fd" }}>per</span>
          </div>
          <div style={{ fontSize: 44, marginTop: 12, lineHeight: 1.2 }}>{text.tagline}</div>
          <div style={{ fontSize: 30, marginTop: 24, color: "#6ee7b7" }}>{text.uses}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
