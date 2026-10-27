"use client";

import { useRef, useState, type ReactNode } from "react";
import { getEngine } from "@/lib/client/engine";
import { ACCEPTED_FILES, maxUploadBytes, prepareUpload } from "@/lib/client/files";
import { useT } from "@/lib/client/i18n";
import {
  addDoc,
  contentKey,
  createPrep,
  deletePrep,
  removeDoc,
  setActivePrep,
  updatePrep,
  usePreps,
  type Prep,
} from "@/lib/client/preps";
import type { ExtractResult, GithubRepo, PrepBrief, PrepKind } from "@/lib/shared/types";
import { CloseIcon } from "./icons";
import { Chips } from "./NotesPage";
import { Page } from "./Page";

const KINDS: readonly PrepKind[] = ["interview", "meeting", "presentation", "exam", "sales", "other"];

const BUTTON = "rounded-xl bg-white/5 px-3 py-2 text-sm text-zinc-200 active:bg-white/10 disabled:opacity-40";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-base leading-relaxed outline-none focus:border-violet-400/60";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** All public repos of a GitHub user in a few lines, so Aivia knows the whole portfolio. */
function profileDoc(user: string, repos: GithubRepo[]): string {
  return [
    `GitHub-profil: https://github.com/${user}`,
    `Öppna projekt (${repos.length}):`,
    ...repos.map(
      (r) =>
        `- ${r.name}${r.language ? ` (${r.language})` : ""}${r.description ? `: ${r.description}` : ""}` +
        ` · uppdaterad ${r.pushedAt.slice(0, 10)}${r.stars ? ` · ${r.stars} stjärnor` : ""}`,
    ),
  ].join("\n");
}

function LinkAdder({ prepId, onError }: { prepId: string; onError: (message: string) => void }) {
  const t = useT();
  const engine = getEngine();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ user: string; repos: GithubRepo[]; chosen: string[] } | null>(null);

  const add = (doc: ExtractResult) => {
    const problem = addDoc(prepId, { name: doc.name, text: doc.text, truncated: doc.truncated, kind: doc.kind, url: doc.url });
    if (problem) throw new Error(problem);
  };

  const fetchLink = async () => {
    const value = url.trim();
    if (!value) return;
    setBusy(value);
    try {
      const result = await engine.readLink(value);
      if (result.type === "doc") {
        add(result.doc);
        setUrl("");
      } else if (result.repos.length === 0) {
        onError(t.prep.noRepos(result.user));
      } else {
        setPicker({ user: result.user, repos: result.repos, chosen: result.repos.slice(0, 3).map((r) => r.name) });
      }
    } catch (err) {
      onError(`${value}: ${errorText(err, t.prep.unreadable)}`);
    } finally {
      setBusy(null);
    }
  };

  const fetchRepos = async () => {
    if (!picker) return;
    const { user, repos, chosen } = picker;
    setPicker(null);
    setUrl("");
    const problem = addDoc(prepId, { name: t.prep.githubProfile(user), text: profileDoc(user, repos), kind: "web", url: `https://github.com/${user}` });
    if (problem) {
      onError(problem);
      return;
    }
    for (const repo of repos.filter((r) => chosen.includes(r.name))) {
      setBusy(repo.name);
      try {
        const result = await engine.readLink(repo.url);
        if (result.type === "doc") add(result.doc);
      } catch (err) {
        onError(`${repo.name}: ${errorText(err, t.prep.unreadable)}`);
      }
    }
    setBusy(null);
  };

  const toggle = (name: string) =>
    setPicker((p) =>
      p ? { ...p, chosen: p.chosen.includes(name) ? p.chosen.filter((n) => n !== name) : [...p.chosen, name] } : p,
    );

  return (
    <div className="mt-3 space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void fetchLink();
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={2000}
          placeholder={t.prep.linkPlaceholder}
          className={`${INPUT} min-w-0 flex-1`}
          disabled={busy !== null}
        />
        <button type="submit" disabled={!url.trim() || busy !== null} className={`shrink-0 ${BUTTON}`}>
          {t.prep.fetch}
        </button>
      </form>
      <p className="text-xs leading-relaxed text-zinc-500">{t.prep.linkHint}</p>
      {busy && <p className="animate-pulse text-sm text-violet-200">{t.prep.reading(busy)}</p>}
      {picker && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-sm font-medium text-zinc-100">{t.prep.pickRepos(picker.user)}</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {picker.repos.map((r) => (
              <li key={r.name}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1.5 active:bg-white/5">
                  <input
                    type="checkbox"
                    checked={picker.chosen.includes(r.name)}
                    onChange={() => toggle(r.name)}
                    className="mt-1 size-4 accent-violet-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-zinc-100">
                      {r.name}
                      {r.language && <span className="text-zinc-500"> · {r.language}</span>}
                    </span>
                    {r.description && <span className="block truncate text-xs text-zinc-500">{r.description}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPicker(null)} className={BUTTON}>
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void fetchRepos()}
              disabled={picker.chosen.length === 0}
              className="rounded-xl bg-violet-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {t.prep.fetchRepos(picker.chosen.length)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-zinc-200">{title}</h3>
      {children}
    </section>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h4>
      <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-zinc-200">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-violet-300">•</span>
            <span className="min-w-0 flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BriefView({ brief }: { brief: PrepBrief }) {
  const t = useT();
  const [openQ, setOpenQ] = useState<number | null>(null);
  const engine = getEngine();
  return (
    <article className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
      <h3 className="text-lg leading-snug font-semibold text-white">{brief.title}</h3>
      {brief.pitch && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t.prep.pitch}</h4>
          <p className="mt-1.5 leading-relaxed text-zinc-200">{brief.pitch}</p>
          <button type="button" onClick={() => engine.readAloud(brief.pitch, brief.lang)} className={`mt-2 ${BUTTON}`}>
            {t.common.listen}
          </button>
        </div>
      )}
      {brief.questions.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t.prep.questions}</h4>
          <ul className="mt-1.5 space-y-1.5">
            {brief.questions.map((q, i) => (
              <li key={i} className="rounded-xl bg-black/20">
                <button
                  type="button"
                  onClick={() => setOpenQ(openQ === i ? null : i)}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-zinc-100"
                >
                  {q.q}
                </button>
                {openQ === i && (
                  <div className="px-3 pb-3">
                    <p className="text-sm leading-relaxed text-zinc-300">{q.a}</p>
                    <button type="button" onClick={() => engine.readAloud(q.a, brief.lang)} className={`mt-2 ${BUTTON}`}>
                      {t.common.listen}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <BriefList title={t.prep.facts} items={brief.facts} />
      <BriefList title={t.prep.askThem} items={brief.askThem} />
      <BriefList title={t.prep.watchOut} items={brief.watchOut} />
    </article>
  );
}

function PrepEditor({ prep, active, onBack }: { prep: Prep; active: boolean; onBack: () => void }) {
  const t = useT();
  const engine = getEngine();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(prep.title);
  const [notes, setNotes] = useState(prep.notes);
  const [reading, setReading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const hints = t.prep.hints[prep.kind];
  const kindOptions = KINDS.map((value) => ({ value, label: t.prep.kinds[value] }));

  const saveText = () => {
    if (title.trim() !== prep.title || notes.trim() !== prep.notes) {
      updatePrep(prep.id, { title: title.trim().slice(0, 120), notes: notes.trim().slice(0, 2000) });
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrors([]);
    for (const file of Array.from(files)) {
      setReading((r) => [...r, file.name]);
      try {
        const { blob, name } = await prepareUpload(file);
        if (blob.size > maxUploadBytes(name)) throw new Error(/\.zip$/i.test(name) ? t.prep.zipTooBig : t.prep.tooBig);
        const result = await engine.readFile(blob, name);
        const problem = addDoc(prep.id, {
          name: result.kind === "code" ? result.name : file.name,
          text: result.text,
          ai: result.method === "ai",
          truncated: result.truncated,
          kind: result.kind,
        });
        if (problem) throw new Error(problem);
      } catch (err) {
        setErrors((e) => [...e, `${file.name}: ${errorText(err, t.prep.unreadable)}`]);
      } finally {
        setReading((r) => r.filter((n) => n !== file.name));
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const addPasted = () => {
    const text = pasteText.trim();
    if (!text) return;
    const problem = addDoc(prep.id, { name: pasteName.trim() || t.prep.pastedName, text });
    if (problem) {
      setErrors([problem]);
      return;
    }
    setPasteText("");
    setPasteName("");
    setPasteOpen(false);
  };

  const makeBrief = async () => {
    saveText();
    setBriefBusy(true);
    setBriefError(null);
    try {
      const fresh = { ...prep, title: title.trim(), notes: notes.trim() };
      const brief = await engine.makeBrief(fresh);
      updatePrep(prep.id, {
        brief,
        briefKey: contentKey(fresh),
        title: fresh.title || brief.title,
      });
      if (!fresh.title) setTitle(brief.title);
      setActivePrep(prep.id);
    } catch (err) {
      setBriefError(errorText(err, t.prep.failed));
    } finally {
      setBriefBusy(false);
    }
  };

  const stale = !!prep.brief && prep.briefKey !== contentKey({ ...prep, notes: notes.trim() });
  const hasMaterial = prep.docs.length > 0 || notes.trim() !== "";

  const back = () => {
    engine.stopReading();
    if (!title.trim() && !hasMaterial && !prep.brief) deletePrep(prep.id);
    else saveText();
    onBack();
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={back} className="text-sm text-zinc-400 active:text-zinc-200">
        {t.prep.all}
      </button>

      <button
        type="button"
        onClick={() => setActivePrep(active ? null : prep.id)}
        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left ${
          active ? "border-emerald-400/30 bg-emerald-500/10" : "border-white/10 bg-white/5 active:bg-white/10"
        }`}
      >
        <span>
          <span className={`block font-medium ${active ? "text-emerald-200" : "text-zinc-100"}`}>
            {active ? t.prep.activeOn : t.prep.activeOff}
          </span>
          <span className="block text-xs text-zinc-400">{active ? t.prep.activeOnHint : t.prep.activeOffHint}</span>
        </span>
        <span
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${active ? "bg-emerald-500" : "bg-white/15"}`}
          aria-hidden
        >
          <span className={`absolute top-1 size-5 rounded-full bg-white transition ${active ? "left-6" : "left-1"}`} />
        </span>
      </button>

      <Section title={t.prep.whatKind}>
        <Chips value={prep.kind} options={kindOptions} onChange={(kind) => updatePrep(prep.id, { kind })} />
      </Section>

      <Section title={t.prep.name}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveText}
          maxLength={120}
          placeholder={hints.title}
          className={INPUT}
        />
      </Section>

      <Section title={t.prep.material(prep.docs.length)}>
        <p className="mb-2.5 text-sm leading-relaxed text-zinc-400">{hints.docs}</p>
        {prep.docs.length > 0 && (
          <ul className="mb-2.5 space-y-1.5">
            {prep.docs.map((d) => (
              <li key={d.id} className="rounded-xl border border-white/10 bg-white/[0.03]">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setPreviewId(previewId === d.id ? null : d.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm text-zinc-100">{d.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {d.kind === "code" && <span className="text-emerald-300">{t.prep.codeTag} · </span>}
                      {d.kind === "web" && <span className="text-sky-300">{t.prep.webTag} · </span>}
                      {t.prep.chars(d.text.length)}
                      {d.ai && ` · ${t.prep.readByAi}`}
                      {d.truncated && ` · ${t.prep.truncated}`} · {previewId === d.id ? t.prep.hideText : t.prep.showText}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDoc(prep.id, d.id)}
                    aria-label={`${t.common.delete} ${d.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 active:bg-white/10"
                  >
                    <CloseIcon width={16} height={16} />
                  </button>
                </div>
                {previewId === d.id && (
                  <p className="max-h-60 overflow-y-auto border-t border-white/5 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
                    {d.text.slice(0, 4000)}
                    {d.text.length > 4000 && " …"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {reading.map((name) => (
          <p key={name} className="mb-1.5 animate-pulse text-sm text-violet-200">
            {t.prep.reading(name)}
          </p>
        ))}
        {errors.map((e) => (
          <p key={e} className="mb-1.5 text-sm text-rose-300">
            {e}
          </p>
        ))}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} className={BUTTON}>
            {t.prep.upload}
          </button>
          <button type="button" onClick={() => setPasteOpen((v) => !v)} className={BUTTON}>
            {t.prep.paste}
          </button>
          <button type="button" onClick={() => setLinkOpen((v) => !v)} className={`col-span-2 ${BUTTON}`}>
            {t.prep.addLink}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">{t.prep.formats}</p>
        {linkOpen && <LinkAdder prepId={prep.id} onError={(message) => setErrors((e) => [...e, message])} />}
        {pasteOpen && (
          <div className="mt-3 space-y-2">
            <input
              value={pasteName}
              onChange={(e) => setPasteName(e.target.value)}
              maxLength={120}
              placeholder={t.prep.pasteTitle}
              className={INPUT}
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={t.prep.pasteText}
              className={`${INPUT} resize-none`}
            />
            <button type="button" onClick={addPasted} disabled={!pasteText.trim()} className={`w-full ${BUTTON}`}>
              {t.common.add}
            </button>
          </div>
        )}
      </Section>

      <Section title={t.prep.highlight}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveText}
          rows={3}
          maxLength={2000}
          placeholder={hints.notes}
          className={`${INPUT} resize-none`}
        />
      </Section>

      <div>
        <button
          type="button"
          onClick={makeBrief}
          disabled={briefBusy || reading.length > 0 || !hasMaterial}
          className="w-full rounded-2xl bg-white py-3.5 font-semibold text-black disabled:opacity-40"
        >
          {briefBusy ? t.prep.preparing : prep.brief ? (stale ? t.prep.update : t.prep.redo) : t.prep.prepare}
        </button>
        <p className="mt-2 text-center text-xs leading-relaxed text-zinc-500">{stale ? t.prep.stale : t.prep.prepareHint}</p>
        {briefError && <p className="mt-2 text-sm text-rose-300">{briefError}</p>}
      </div>

      {prep.brief && <BriefView brief={prep.brief} />}

      <button
        type="button"
        onClick={() => {
          if (window.confirm(t.prep.deleteConfirm)) {
            deletePrep(prep.id);
            onBack();
          }
        }}
        className="w-full text-center text-xs text-zinc-500 active:text-zinc-300"
      >
        {t.prep.delete}
      </button>
    </div>
  );
}

export function PrepPage() {
  const t = useT();
  const { preps, activeId } = usePreps();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = preps.find((p) => p.id === openId) ?? null;

  return (
    <Page title={t.prep.title}>
      {open ? (
        <PrepEditor key={open.id} prep={open} active={open.id === activeId} onBack={() => setOpenId(null)} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-zinc-400">{t.prep.intro}</p>
          <button
            type="button"
            onClick={() => setOpenId(createPrep().id)}
            className="w-full rounded-2xl bg-white py-3.5 font-semibold text-black"
          >
            {t.prep.new}
          </button>
          {preps.length > 0 && (
            <ul className="space-y-2">
              {preps.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left active:bg-white/10"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      {t.prep.kinds[p.kind]} · {t.common.files(p.docs.length)}
                      {p.id === activeId && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">{t.prep.inUse}</span>
                      )}
                    </div>
                    <div className="mt-0.5 font-medium text-zinc-100">{p.title || t.prep.unnamed}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {activeId && (
            <button
              type="button"
              onClick={() => setActivePrep(null)}
              className="w-full text-center text-sm text-zinc-400 active:text-zinc-200"
            >
              {t.prep.useNone}
            </button>
          )}
        </div>
      )}
    </Page>
  );
}
