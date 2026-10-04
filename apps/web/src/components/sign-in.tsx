"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { authErrorText } from "@/lib/auth";

export type SignInMode = "sign-in" | "sign-up";

export function SignInForm({
  mode,
  busy = false,
  error = null,
  notice = null,
  onMode,
  onSubmit,
}: {
  mode: SignInMode;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  onMode: (mode: SignInMode) => void;
  onSubmit: (email: string, password: string) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit(String(data.get("email") ?? "").trim(), String(data.get("password") ?? ""));
  }

  return (
    <section className="panel auth-panel" aria-labelledby="auth-title">
      <div className="mode-switch" role="group" aria-label="Вход или регистрация">
        <button type="button" aria-pressed={mode === "sign-in"} onClick={() => onMode("sign-in")}>
          Вход
        </button>
        <button type="button" aria-pressed={mode === "sign-up"} onClick={() => onMode("sign-up")}>
          Регистрация
        </button>
      </div>
      <h2 id="auth-title">{mode === "sign-in" ? "Влезте в профила си" : "Нов профил"}</h2>
      <form className="form" onSubmit={submit}>
        <label className="field">
          Имейл
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          Парола
          <input
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={mode === "sign-up" ? 6 : undefined}
            required
          />
        </label>
        {error && (
          <p className="notice" data-tone="bad" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" data-tone="info" role="status">
            {notice}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? "Изчакване…" : mode === "sign-in" ? "Влез" : "Създай профил"}
          </button>
        </div>
      </form>
      <p className="muted">
        Входът минава през Supabase и изисква интернет. Портфолиото, таблата и симулаторът работят и без вход.
      </p>
    </section>
  );
}

export function SignIn() {
  const { state, signIn, signUp, signOut } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<SignInMode>("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === "loading") {
    return (
      <p className="muted" aria-busy="true">
        Проверка на входа…
      </p>
    );
  }
  if (state.status === "signed-in") {
    return (
      <section className="panel auth-panel">
        <p>
          Влезли сте като <strong>{state.email ?? "потребител без имейл"}</strong>.
        </p>
        <div className="form-actions">
          <Link className="button button-primary" href="/my-sites">
            Към моите обекти
          </Link>
          <button type="button" onClick={() => void signOut().catch((reason) => setError(authErrorText(reason)))}>
            Изход
          </button>
        </div>
        {error && (
          <p className="notice" data-tone="bad" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  async function submit(email: string, password: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
        router.push("/my-sites");
      } else if ((await signUp(email, password)) === "signed-in") {
        router.push("/my-sites");
      } else {
        setMode("sign-in");
        setNotice("Профилът е създаден. Потвърдете имейла от писмото на Supabase и после влезте.");
      }
    } catch (reason) {
      setError(authErrorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInForm
      mode={mode}
      busy={busy}
      error={error}
      notice={notice}
      onMode={(next) => {
        setMode(next);
        setError(null);
        setNotice(null);
      }}
      onSubmit={(email, password) => void submit(email, password)}
    />
  );
}
