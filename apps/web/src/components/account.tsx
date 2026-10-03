"use client";

import Link from "next/link";
import { useState } from "react";
import { BuildingIcon } from "@/components/icons";
import { useAuth, type AuthState } from "@/hooks/use-auth";
import { authErrorText } from "@/lib/auth";

/** „Моите обекти“ in the sidebar, only for a signed-in user. */
export function MySitesLink({ auth, pathname }: { auth: AuthState; pathname: string }) {
  if (auth.status !== "signed-in") return null;
  return (
    <Link
      className="nav-link"
      href="/my-sites"
      aria-current={pathname === "/my-sites" ? "page" : undefined}
      data-active={pathname.startsWith("/my-sites/")}
    >
      <BuildingIcon />
      Моите обекти
    </Link>
  );
}

/** Who is signed in, with „Изход“; „Вход“ otherwise. Nothing at all when sign-in is not configured. */
export function AccountPanel({
  auth,
  busy = false,
  error = null,
  onSignOut,
}: {
  auth: AuthState;
  busy?: boolean;
  error?: string | null;
  onSignOut: () => void;
}) {
  if (auth.status === "disabled") return null;
  if (auth.status === "loading") {
    return (
      <div className="account" aria-busy="true">
        <span className="muted">Проверка на входа…</span>
      </div>
    );
  }
  if (auth.status === "signed-out") {
    return (
      <div className="account">
        <span className="muted">Влезте, за да добавяте свои обекти и устройства.</span>
        <Link className="button button-small" href="/sign-in">
          Вход
        </Link>
      </div>
    );
  }
  return (
    <div className="account">
      <span className="muted">Влезли сте като</span>
      <span className="account-email">{auth.email ?? "потребител без имейл"}</span>
      <button type="button" className="button-small" onClick={onSignOut} disabled={busy}>
        {busy ? "Изход…" : "Изход"}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Account() {
  const { state, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (reason) {
      setError(authErrorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return <AccountPanel auth={state} busy={busy} error={error} onSignOut={() => void handleSignOut()} />;
}
