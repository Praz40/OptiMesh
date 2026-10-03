"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FieldError, invalid, otherErrors } from "@/components/form-field";
import { useAuth, type AuthState } from "@/hooks/use-auth";
import { useMySites, type MySitesState } from "@/hooks/use-my-sites";
import { RegistryError, registry, registryErrorText, type FieldErrors, type OwnedSite } from "@/lib/registry";

/** For a page that needs a signed-in user; null once somebody is signed in. */
export function SignInGate({ auth, what }: { auth: AuthState; what: string }) {
  if (auth.status === "signed-in") return null;
  if (auth.status === "signed-out") {
    return (
      <section className="empty-state">
        <h2>Влезте в профила си</h2>
        <p>{what}</p>
        <Link className="button button-primary" href="/sign-in">
          Вход
        </Link>
      </section>
    );
  }
  return (
    <section className="empty-state" aria-busy="true">
      <p>Проверка на входа…</p>
    </section>
  );
}

export function MySitesList({ state, onRetry }: { state: MySitesState; onRetry: () => void }) {
  if (state.status === "signed-out") return null;
  if (state.status === "loading") {
    return (
      <p className="muted" aria-busy="true">
        Зареждане на вашите обекти…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="notice" data-tone="bad" role="alert">
        <span>Обектите не се заредиха. {registryErrorText(state.error)}</span>
        <button type="button" className="button-small" onClick={onRetry}>
          Опитай отново
        </button>
      </div>
    );
  }
  if (state.sites.length === 0) {
    return (
      <section className="empty-state">
        <h2>Още нямате обекти</h2>
        <p>Създайте първия с „Нов обект“: стая, офис или дом. После добавете устройствата му.</p>
      </section>
    );
  }
  return (
    <ul className="owned-list">
      {state.sites.map((site) => (
        <li key={site.id} className="owned-item">
          <div>
            <h3>
              <Link href={`/sites/${site.id}`}>{site.name}</Link>
            </h3>
            <p className="muted">
              {site.timezone.replace("_", " ")} · {site.currency}
            </p>
          </div>
          <div className="owned-actions">
            <Link className="button button-small" href={`/my-sites/${site.id}`}>
              Устройства и свързване
            </Link>
            <Link className="button button-small" href={`/sites/${site.id}`}>
              Табло
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export type SiteFormValues = { name: string; timezone: string; currency: string };

export const NEW_SITE: SiteFormValues = { name: "", timezone: "Europe/Sofia", currency: "EUR" };

const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function SiteForm({
  values,
  errors = {},
  failure = null,
  busy = false,
  onChange,
  onSubmit,
}: {
  values: SiteFormValues;
  errors?: FieldErrors;
  failure?: string | null;
  busy?: boolean;
  onChange: (values: SiteFormValues) => void;
  onSubmit: () => void;
}) {
  const set = (field: keyof SiteFormValues) => (event: { target: { value: string } }) =>
    onChange({ ...values, [field]: event.target.value });
  const rest = otherErrors(errors, ["name", "timezone", "currency"]);

  return (
    <form
      className="form"
      aria-labelledby="new-site-title"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="form-row">
        <label className="field">
          Име
          <input
            name="name"
            value={values.name}
            onChange={set("name")}
            maxLength={120}
            required
            placeholder="Например: Офис София"
            {...invalid("site-name-error", errors.name)}
          />
          <FieldError id="site-name-error" message={errors.name} />
        </label>
        <label className="field">
          Часова зона
          <input
            name="timezone"
            value={values.timezone}
            onChange={set("timezone")}
            list="timezones"
            maxLength={80}
            required
            {...invalid("site-timezone-error", errors.timezone)}
          />
          <FieldError id="site-timezone-error" message={errors.timezone} />
        </label>
        <label className="field">
          Валута
          <input
            name="currency"
            value={values.currency}
            onChange={set("currency")}
            maxLength={3}
            required
            {...invalid("site-currency-error", errors.currency)}
          />
          <span className="field-hint">Трибуквен код, напр. EUR</span>
          <FieldError id="site-currency-error" message={errors.currency} />
        </label>
      </div>
      <datalist id="timezones">
        {TIMEZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {rest.map((message) => (
        <p key={message} className="field-error">
          {message}
        </p>
      ))}
      {failure && (
        <p className="notice" data-tone="bad" role="alert">
          {failure}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "Създаване…" : "Създай обекта"}
        </button>
      </div>
    </form>
  );
}

export function MySites() {
  const { state: auth, accessToken } = useAuth();
  const { state, reload, added } = useMySites();
  const [values, setValues] = useState<SiteFormValues>(NEW_SITE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<OwnedSite | null>(null);

  if (auth.status !== "signed-in") {
    return <SignInGate auth={auth} what="Тук са обектите, които сте създали, и устройствата им." />;
  }

  async function create() {
    setBusy(true);
    setErrors({});
    setFailure(null);
    setCreated(null);
    try {
      const token = await accessToken();
      if (!token) throw new RegistryError(401, "Not signed in");
      const site = await registry.createSite(token, {
        name: values.name.trim(),
        timezone: values.timezone.trim(),
        currency: values.currency.trim().toUpperCase(),
      });
      added(site);
      setCreated(site);
      setValues(NEW_SITE);
    } catch (error) {
      if (error instanceof RegistryError && error.status === 422) setErrors(error.fields);
      setFailure(registryErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="new-site-title">
        <div className="panel-head">
          <h2 id="new-site-title">Нов обект</h2>
          <span className="muted">Стая, офис, дом: всеки обект има свои устройства</span>
        </div>
        <SiteForm
          values={values}
          errors={errors}
          failure={failure}
          busy={busy}
          onChange={setValues}
          onSubmit={() => void create()}
        />
        {created && (
          <p className="notice" data-tone="info" role="status">
            Обектът „{created.name}“ е създаден.{" "}
            <Link href={`/my-sites/${created.id}`}>Добавете устройствата му.</Link>
          </p>
        )}
      </section>
      <section className="panel" aria-labelledby="my-sites-title">
        <div className="panel-head">
          <h2 id="my-sites-title">Вашите обекти</h2>
          <span className="muted">Най-новите са първи</span>
        </div>
        <MySitesList state={state} onRetry={reload} />
      </section>
    </div>
  );
}
