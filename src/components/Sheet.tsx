"use client";

import { useEffect, type ReactNode } from "react";
import { useT } from "@/lib/client/i18n";
import { CloseIcon } from "./icons";

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={t.common.close} className="h-[max(env(safe-area-inset-top),16px)] shrink-0" onClick={onClose} />
      <div className="sheet-in mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full bg-white/5 text-zinc-300 active:bg-white/10"
            aria-label={t.common.close}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-safe">{children}</div>
      </div>
    </div>
  );
}
