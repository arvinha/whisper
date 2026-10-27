"use client";

import type { Notice } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { CloseIcon } from "./icons";

const TONE: Record<Notice["tone"], string> = {
  info: "border-sky-400/30 bg-sky-950/90 text-sky-100",
  warn: "border-amber-400/30 bg-amber-950/90 text-amber-100",
  error: "border-rose-400/30 bg-rose-950/90 text-rose-100",
};

export function NoticeBar({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const t = useT();
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-safe">
      <div
        role={notice.tone === "error" ? "alert" : "status"}
        className={`notice-in pointer-events-auto mt-2 flex w-full max-w-xl items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${TONE[notice.tone]}`}
      >
        <p className="flex-1 leading-relaxed">{notice.text}</p>
        <button type="button" onClick={onDismiss} aria-label={t.common.close} className="-mr-1 shrink-0 opacity-70">
          <CloseIcon width={18} height={18} />
        </button>
      </div>
    </div>
  );
}
