"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "@/lib/client/api";
import { getEngine } from "@/lib/client/engine";
import { useT, useUiLang } from "@/lib/client/i18n";
import type { Dict } from "@/lib/i18n";
import {
  ANSWER_ORE,
  LISTEN_ORE_PER_MINUTE,
  TOPUPS,
  TOPUP_KINDS,
  TRIAL_MINUTES,
  oreToKr,
  type Currency,
} from "@/lib/shared/pricing";
import type { AccountInfo, AuthProvider, CheckoutKind, PublicConfig } from "@/lib/shared/types";
import { PasswordForm } from "./PasswordForm";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const POPULAR: CheckoutKind = "kr100";

const input =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-base outline-none focus:border-violet-400/60";

function errorText(err: unknown, t: Dict): string {
  if (!(err instanceof ApiError)) return t.errors.generic;
  if (err.status === 401) return t.account.wrongLogin;
  if (err.status === 429) return t.account.tooMany;
  return err.message;
}

const PRIMARY = "w-full rounded-xl bg-violet-500 py-3 font-medium text-white disabled:opacity-40";
const LINK = "text-sm text-violet-300 active:text-violet-200";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width={20} height={20} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.78c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.9-3.75 2.27-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.96-.74 1.39 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.39-3.66zM14.1 6.03c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.76-.96 2.8 1.02.08 2.05-.52 2.68-1.28z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" width={18} height={18} aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="currentColor">
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}

const PROVIDER_LOOK: Record<AuthProvider, { name: string; logo: () => ReactNode; className: string }> = {
  apple: { name: "Apple", logo: AppleLogo, className: "bg-white text-black" },
  google: { name: "Google", logo: GoogleLogo, className: "bg-white text-zinc-900" },
  facebook: { name: "Facebook", logo: FacebookLogo, className: "bg-[#1877F2] text-white" },
  microsoft: { name: "Microsoft", logo: MicrosoftLogo, className: "border border-white/15 bg-white/5 text-white" },
};

type Step = "start" | "signup" | "signupCodes" | "password" | "forgot" | "reset" | "family";

const SECONDARY = "w-full rounded-xl border border-white/15 bg-white/5 py-3 font-medium text-zinc-100 active:bg-white/10";

function TermsCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const t = useT();
  const link = "text-violet-300 underline underline-offset-2";
  return (
    <label className="flex items-start gap-2.5 text-sm leading-relaxed text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-violet-500"
      />
      <span>
        {t.account.termsBefore}
        <a href={t.account.termsUrl} target="_blank" rel="noreferrer" className={link}>
          {t.account.termsLink}
        </a>
        {t.account.termsMiddle}
        <a href={t.account.privacyUrl} target="_blank" rel="noreferrer" className={link}>
          {t.account.privacyLink}
        </a>
        .
      </span>
    </label>
  );
}

function CodeInput({
  value,
  onChange,
  label,
  autoFocus = false,
  fromSms = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  autoFocus?: boolean;
  fromSms?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm text-zinc-400">{label}</span>}
      <input
        inputMode="numeric"
        autoComplete={fromSms ? "one-time-code" : "off"}
        autoFocus={autoFocus}
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        className={`${input} text-center text-2xl tracking-[0.4em]`}
      />
    </label>
  );
}

/**
 * Sign up or log in: Apple/Google/Microsoft, a new account (e-mail, mobile number, password,
 * terms; checked with one code by e-mail and one by text), a password, or a family code.
 */
export function AuthForm({ config, onDone }: { config: PublicConfig; onDone?: () => void }) {
  const t = useT();
  const engine = getEngine();
  const { mail, sms, providers, enabled } = config.accounts;
  const canSignUp = enabled && mail && sms;
  const [step, setStep] = useState<Step>(enabled && (canSignUp || providers.length > 0) ? "start" : enabled ? "password" : "family");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [code, setCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const go = (next: Step) => {
    setStep(next);
    setError(null);
    setInfo(null);
    setCode("");
    setSmsCode("");
  };

  const run = async (action: () => Promise<boolean | void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const ok = await action();
      if (ok === true) onDone?.();
      else if (ok === false) setError(t.errors.generic);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const sendResetCode = (e?: FormEvent) => {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError(t.account.badEmail);
    void run(async () => {
      await engine.requestResetCode(email.trim());
      if (step === "reset") setInfo(t.account.resent);
      else go("reset");
    });
  };

  const submitSignup = (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError(t.account.badName);
    if (!EMAIL_RE.test(email.trim())) return setError(t.account.badEmail);
    if (!phone.trim()) return setError(t.account.badPhone);
    if (password.length < 8) return setError(t.account.shortPassword);
    if (!terms) return setError(t.account.needTerms);
    void run(async () => {
      setSentPhone(await engine.signUp({ name: name.trim(), email: email.trim(), phone, password, terms }));
      if (step === "signupCodes") setInfo(t.account.resent);
      else go("signupCodes");
    });
  };

  const emailInput = (autoFocus = false) => (
    <input
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      autoFocus={autoFocus}
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder={t.account.email}
      className={input}
    />
  );

  const message = (
    <>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {info && <p className="text-sm text-emerald-300">{info}</p>}
    </>
  );

  if (step === "family") {
    return (
      <div className="space-y-3">
        <PasswordForm onDone={onDone} />
        {enabled && (
          <button type="button" onClick={() => go("start")} className={LINK}>
            {t.account.back}
          </button>
        )}
      </div>
    );
  }

  if (step === "signup") {
    return (
      <form onSubmit={submitSignup} className="space-y-3">
        <p className="font-medium text-zinc-100">{t.account.signupTitle}</p>
        <input
          autoComplete="given-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.account.name}
          className={input}
        />
        {emailInput()}
        <div className="space-y-1.5">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.account.phone}
            className={input}
          />
          <p className="text-xs leading-relaxed text-zinc-500">{t.account.phoneHint}</p>
        </div>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`${t.account.password} (${t.account.passwordHint.toLowerCase()})`}
          className={input}
        />
        <TermsCheck checked={terms} onChange={setTerms} />
        {message}
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? "…" : t.account.createAccount}
        </button>
        <div className="flex justify-between">
          <button type="button" onClick={() => go("start")} className={LINK}>
            {t.account.back}
          </button>
          <button type="button" onClick={() => go("password")} className={LINK}>
            {t.account.passwordLogin}
          </button>
        </div>
      </form>
    );
  }

  if (step === "signupCodes") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => engine.finishSignUp(email.trim(), code, smsCode));
        }}
        className="space-y-3"
      >
        <p className="text-sm leading-relaxed text-zinc-300">{t.account.codesSent(email.trim(), sentPhone)}</p>
        <CodeInput value={code} onChange={setCode} label={t.account.mailCode} autoFocus />
        <CodeInput value={smsCode} onChange={setSmsCode} label={t.account.smsCode} fromSms />
        {message}
        <button type="submit" disabled={busy || code.length !== 6 || smsCode.length !== 6} className={PRIMARY}>
          {busy ? "…" : t.account.createAccount}
        </button>
        <div className="flex justify-between">
          <button type="button" onClick={() => go("signup")} className={LINK}>
            {t.account.changeDetails}
          </button>
          <button type="button" disabled={busy} onClick={() => submitSignup()} className={LINK}>
            {t.account.resendCodes}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">{t.account.checkSpam}</p>
      </form>
    );
  }

  if (step === "password") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!EMAIL_RE.test(email.trim())) return setError(t.account.badEmail);
          void run(() => engine.signIn(email.trim(), password));
        }}
        className="space-y-3"
      >
        <p className="font-medium text-zinc-100">{t.account.loginTitle}</p>
        {emailInput()}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t.account.password}
          className={input}
        />
        {message}
        <button type="submit" disabled={busy || !email.trim() || !password} className={PRIMARY}>
          {busy ? "…" : t.account.login}
        </button>
        <div className="flex justify-between">
          {canSignUp || providers.length > 0 ? (
            <button type="button" onClick={() => go("start")} className={LINK}>
              {t.account.back}
            </button>
          ) : (
            <button type="button" onClick={() => go("family")} className={LINK}>
              {t.account.haveCode}
            </button>
          )}
          {mail && (
            <button type="button" onClick={() => go("forgot")} className={LINK}>
              {t.account.forgotPassword}
            </button>
          )}
        </div>
        {canSignUp && (
          <button type="button" onClick={() => go("signup")} className={LINK}>
            {t.account.noAccount}
          </button>
        )}
      </form>
    );
  }

  if (step === "forgot") {
    return (
      <form onSubmit={sendResetCode} className="space-y-3">
        <p className="font-medium text-zinc-100">{t.account.forgotTitle}</p>
        <p className="text-sm leading-relaxed text-zinc-400">{t.account.forgotText}</p>
        {emailInput(true)}
        {message}
        <button type="submit" disabled={busy || !email.trim()} className={PRIMARY}>
          {busy ? "…" : t.account.sendCode}
        </button>
        <button type="button" onClick={() => go("password")} className={LINK}>
          {t.account.back}
        </button>
      </form>
    );
  }

  if (step === "reset") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password.length < 8) return setError(t.account.shortPassword);
          void run(() => engine.resetPassword(email.trim(), code, password));
        }}
        className="space-y-3"
      >
        <p className="text-sm leading-relaxed text-zinc-300">{t.account.codeSent(email.trim())}</p>
        <CodeInput value={code} onChange={setCode} autoFocus />
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`${t.account.newPassword} (${t.account.passwordHint.toLowerCase()})`}
          className={input}
        />
        {message}
        <button type="submit" disabled={busy || code.length !== 6 || !password} className={PRIMARY}>
          {busy ? "…" : t.account.savePassword}
        </button>
        <div className="flex justify-between">
          <button type="button" onClick={() => go("password")} className={LINK}>
            {t.account.back}
          </button>
          <button type="button" disabled={busy} onClick={() => sendResetCode()} className={LINK}>
            {t.account.resend}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {providers.map((p) => {
        const look = PROVIDER_LOOK[p];
        return (
          <button
            key={p}
            type="button"
            onClick={() => engine.signInWith(p)}
            className={`flex w-full items-center justify-center gap-2.5 rounded-xl py-3 font-medium active:opacity-80 ${look.className}`}
          >
            {look.logo()} {t.account.continueWith(look.name)}
          </button>
        );
      })}
      {providers.length > 0 && (
        <div className="flex items-center gap-3 py-1 text-xs text-zinc-500">
          <span className="h-px flex-1 bg-white/10" /> {t.account.or} <span className="h-px flex-1 bg-white/10" />
        </div>
      )}
      {canSignUp && (
        <button type="button" onClick={() => go("signup")} className={PRIMARY}>
          {t.account.signupCta}
        </button>
      )}
      <button type="button" onClick={() => go("password")} className={SECONDARY}>
        {t.account.passwordLogin}
      </button>
      {message}
      <div className="flex justify-end pt-1">
        <button type="button" onClick={() => go("family")} className={LINK}>
          {t.account.haveCode}
        </button>
      </div>
    </div>
  );
}

/** Logo and frame shared by the sign-in screen and the "one last step" screen. */
function AuthShell({ intro, children, footer }: { intro: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-8">
      <div className="flex flex-1 flex-col justify-center py-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 grid size-20 place-items-center rounded-full border border-white/10 bg-gradient-to-b from-zinc-800 to-zinc-950 shadow-[0_0_60px_-10px_rgba(167,139,250,0.6)]">
            <svg viewBox="0 0 40 24" width={40} height={24} aria-hidden="true">
              {[4, 10, 16, 22, 28, 34].map((x, i) => {
                const h = [6, 14, 22, 16, 10, 5][i];
                return <rect key={x} x={x - 1.5} y={12 - h / 2} width={3} height={h} rx={1.5} fill={i % 2 ? "#c4b5fd" : "#fff"} />;
              })}
            </svg>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            whis<span className="text-violet-300">per</span>
          </h1>
          {intro}
        </div>
        {children}
      </div>
      {footer}
    </main>
  );
}

function LegalLinks() {
  const t = useT();
  return (
    <p className="text-center text-xs leading-relaxed text-zinc-600">
      {t.account.agree}{" "}
      <a href={t.account.termsUrl} className="underline underline-offset-2 hover:text-zinc-400">
        {t.account.termsName}
      </a>
      {" · "}
      <a href={t.account.privacyUrl} className="underline underline-offset-2 hover:text-zinc-400">
        {t.account.privacyName}
      </a>
    </p>
  );
}

/** The first screen when nobody is signed in. */
export function AuthScreen({ config }: { config: PublicConfig }) {
  const t = useT();
  const accounts = config.accounts.enabled;
  return (
    <AuthShell
      intro={
        <>
          <p className="mt-2 text-balance text-zinc-400">{t.account.welcomeText}</p>
          {accounts && <p className="mt-3 text-sm font-medium text-emerald-300">{t.account.noCard}</p>}
        </>
      }
      footer={
        <>
          <p className="mb-3 text-center text-sm">
            <a href={t.account.learnMoreUrl} className="text-violet-300 underline-offset-4 hover:underline">
              {t.account.learnMore}
            </a>
          </p>
          {accounts && <LegalLinks />}
        </>
      }
    >
      <AuthForm config={config} />
    </AuthShell>
  );
}

/**
 * Shown to a signed-in account that lacks a checked mobile number, today's terms or a way to log
 * in (made before these rules, or with Google/Apple/Microsoft). Nothing else works until it is done.
 */
export function SetupScreen({ account }: { account: AccountInfo }) {
  const t = useT();
  const engine = getEngine();
  const [phone, setPhone] = useState(account.phone);
  const [sentTo, setSentTo] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const phoneChecked = !!account.phone && phone === account.phone;
  const termsOnly = phoneChecked && !account.needsPassword;
  const ready =
    (phoneChecked || (sentTo !== "" && smsCode.length === 6)) && terms && (!account.needsPassword || password.length >= 8);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => {
    if (!phone.trim()) return setError(t.account.badPhone);
    void run(async () => {
      const number = await engine.sendPhoneCode(phone);
      setSentTo(number);
      setInfo(t.account.smsSent(number));
    });
  };

  const finish = (e: FormEvent) => {
    e.preventDefault();
    if (!terms) return setError(t.account.needTerms);
    if (account.needsPassword && password.length < 8) return setError(t.account.shortPassword);
    void run(() =>
      engine.completeAccount({
        phone: phoneChecked ? account.phone : sentTo,
        smsCode,
        terms,
        password: account.needsPassword ? password : undefined,
      }),
    );
  };

  return (
    <AuthShell
      intro={
        <>
          <p className="mt-4 text-lg font-medium text-zinc-100">{t.account.setupTitle}</p>
          <p className="mt-2 text-balance text-sm leading-relaxed text-zinc-400">
            {termsOnly ? t.account.setupTermsOnly : t.account.setupText}
          </p>
        </>
      }
      footer={
        <p className="text-center text-sm">
          <button type="button" onClick={() => engine.logout()} className={LINK}>
            {t.account.logout} ({account.email})
          </button>
        </p>
      }
    >
      <form onSubmit={finish} className="space-y-3">
        {!termsOnly && (
          <>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setSentTo("");
                setSmsCode("");
              }}
              placeholder={t.account.phone}
              className={input}
            />
            {!phoneChecked && (
              <button
                type="button"
                disabled={busy || !phone.trim()}
                onClick={sendCode}
                className="w-full rounded-xl border border-violet-400/40 bg-violet-500/15 py-3 font-medium text-violet-100 disabled:opacity-40"
              >
                {sentTo ? t.account.resend : t.account.sendSmsCode}
              </button>
            )}
            {sentTo && !phoneChecked && <CodeInput value={smsCode} onChange={setSmsCode} label={t.account.smsCode} autoFocus fromSms />}
            {account.needsPassword && (
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.account.choosePassword}
                className={input}
              />
            )}
          </>
        )}
        <TermsCheck checked={terms} onChange={setTerms} />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {info && <p className="text-sm text-emerald-300">{info}</p>}
        <button type="submit" disabled={busy || !ready} className={PRIMARY}>
          {busy ? "…" : t.account.finish}
        </button>
      </form>
    </AuthShell>
  );
}

/** The account's currency, or the UI language's before the first top-up. */
export function accountCurrency(account: AccountInfo, lang: string): Currency {
  return account.currency ?? (lang === "da" ? "dkk" : "sek");
}

/** An amount in Swedish öre, shown in the account's currency: "43,20 kr" or "10 öre". */
export function formatMoney(ore: number, currency: Currency, t: Dict): string {
  const kr = oreToKr(ore, currency);
  if (kr > 0 && kr < 1) return t.account.ore(Math.round(kr * 100));
  const whole = Math.abs(kr - Math.round(kr)) < 0.005;
  return `${new Intl.NumberFormat(t.locale, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(kr)} kr`;
}

export function trialMinutesLeft(account: AccountInfo): number {
  return Math.max(1, Math.ceil(account.trialSecondsLeft / 60));
}

function statusLine(a: AccountInfo, currency: Currency, t: Dict): string {
  if (!a.active) {
    if (a.reason === "setup") return t.account.setupNeeded;
    if (a.reason === "empty") return t.account.empty;
    return a.trialDenied ? t.account.trialDenied : t.account.trialOver;
  }
  const balance = t.account.balance(formatMoney(a.balanceOre, currency, t));
  if (a.plan === "prepaid") return balance;
  const minutes = t.account.trialMinutesLeft(trialMinutesLeft(a));
  return a.balanceOre > 0 ? `${minutes} · ${balance}` : minutes;
}

/** Free minutes, balance and the ways to top up. */
export function AccountPanel({ config, account }: { config: PublicConfig; account: AccountInfo }) {
  const t = useT();
  const lang = useUiLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [startNow, setStartNow] = useState(false);
  const currency = accountCurrency(account, lang);
  // No prices while the free minutes last unless the user asks for them; they appear when they are over.
  const inTrial = account.plan === "trial" && account.active;
  const billing = config.accounts.billing && (!inTrial || upgrading);

  const go = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, t));
      setBusy(null);
    }
  };

  const share = inTrial ? Math.min(1, 1 - account.trialSecondsLeft / (TRIAL_MINUTES * 60)) : 0;
  const rates = t.account.rates(formatMoney(LISTEN_ORE_PER_MINUTE, currency, t), formatMoney(ANSWER_ORE, currency, t));

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-zinc-100">{t.account.planName[account.plan]}</span>
          <span className="truncate text-xs text-zinc-500">{account.email}</span>
        </div>
        <p className={`mt-0.5 ${account.active ? "text-zinc-400" : "text-rose-300"}`}>{statusLine(account, currency, t)}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{rates}</p>
      </div>

      {inTrial && (
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${share > 0.8 ? "bg-amber-400" : "bg-violet-400"}`}
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
      )}

      {!billing ? (
        config.accounts.billing && inTrial ? (
          <button
            type="button"
            onClick={() => setUpgrading(true)}
            className="w-full rounded-xl border border-violet-400/30 bg-violet-500/10 px-3.5 py-3 text-left active:bg-violet-500/20"
          >
            <span className="block font-medium text-violet-200">{t.account.upgradeNow}</span>
            <span className="block text-xs text-zinc-400">{t.account.upgradeHint}</span>
          </button>
        ) : !config.accounts.billing && !account.active ? (
          <p className="text-zinc-400">{t.account.billingSoon}</p>
        ) : null
      ) : (
        <>
          <div className="space-y-2">
            <p className="font-medium text-zinc-200">{t.account.packsTitle}</p>
            <p className="text-xs leading-relaxed text-zinc-400">
              {t.account.packsNote}
              {inTrial && ` ${t.account.upgradeNote}`}
            </p>
            <label className="flex items-start gap-2.5 py-1 text-xs leading-relaxed text-zinc-300">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(e) => setStartNow(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-violet-500"
              />
              <span>{t.account.startNow}</span>
            </label>
            {TOPUP_KINDS.map((kind) => (
              <div
                key={kind}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  kind === POPULAR ? "border-violet-400/40 bg-violet-500/10" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-100">
                    {TOPUPS[kind][currency]} kr
                    {kind === POPULAR && (
                      <span className="ml-2 rounded-full bg-violet-500/30 px-2 py-0.5 text-[11px] font-medium text-violet-100">
                        {t.account.popular}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400">{t.account.packDesc[kind]}</p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null || !startNow}
                  onClick={() => void go(kind, () => getEngine().openCheckout(kind))}
                  className="shrink-0 rounded-lg bg-violet-500 px-3.5 py-2 font-medium text-white disabled:opacity-40"
                >
                  {busy === kind ? "…" : t.account.buy}
                </button>
              </div>
            ))}
          </div>

          {account.hasBilling && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void go("portal", () => getEngine().openBillingPortal())}
              className="w-full text-left text-zinc-300 disabled:opacity-40"
            >
              <span className="font-medium text-violet-300">{busy === "portal" ? t.account.opening : t.account.manage}</span>
              <span className="block text-xs text-zinc-500">{t.account.manageHint}</span>
            </button>
          )}
          <p className="text-xs text-zinc-600">{t.account.vat}</p>
        </>
      )}
      {error && <p className="text-rose-400">{error}</p>}
    </div>
  );
}
