"use client";

import { useT } from "@/lib/client/i18n";

export function InterruptedOverlay({ onResume }: { onResume: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onResume}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 px-8 text-center backdrop-blur"
    >
      <span className="text-2xl font-semibold">{t.interrupted.title}</span>
      <span className="max-w-xs text-zinc-400">{t.interrupted.text}</span>
      <span className="mt-4 rounded-full bg-white px-6 py-3 font-medium text-black">{t.interrupted.resume}</span>
    </button>
  );
}
