"use client";

import { useState, type FormEvent } from "react";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    const ok = await getEngine().submitPassword(value.trim());
    setBusy(false);
    if (ok) onDone?.();
    else setError(t.password.wrong);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm text-zinc-300" htmlFor="psst-password">
        {t.password.label}
      </label>
      <div className="flex gap-2">
        <input
          id="psst-password"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.password.placeholder}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-base outline-none focus:border-violet-400/60"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-xl bg-violet-500 px-4 font-medium text-white disabled:opacity-40"
        >
          {busy ? "…" : t.password.unlock}
        </button>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </form>
  );
}
