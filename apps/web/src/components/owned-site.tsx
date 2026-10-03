"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { DeviceConnectPanel } from "@/components/device-connect";
import { FieldError, invalid, otherErrors } from "@/components/form-field";
import { SignInGate } from "@/components/my-sites";
import { useAuth } from "@/hooks/use-auth";
import { useMySites } from "@/hooks/use-my-sites";
import type { Capability, DeviceKind } from "@/lib/api";
import { KIND_LABELS } from "@/lib/energy";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  DEVICE_KINDS,
  RegistryError,
  SOURCE_LABELS,
  deviceBody,
  hasCapacity,
  initialDeviceForm,
  registry,
  registryErrorText,
  withKind,
  type DeviceFormValues,
  type DeviceSource,
  type FieldErrors,
  type OwnedDevice,
} from "@/lib/registry";

export type DevicesState =
  | { status: "loading" }
  | { status: "ready"; devices: OwnedDevice[] }
  | { status: "failed"; error: unknown };

/** Kept in the API's order: by name, then id. */
const byName = (a: OwnedDevice, b: OwnedDevice) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function limitsText(device: OwnedDevice): string | null {
  const { min_power_w: min, max_power_w: max, capacity_wh: capacity } = device.limits;
  const parts = [
    min !== undefined && `мин. ${min} W`,
    max !== undefined && `макс. ${max} W`,
    capacity !== undefined && `капацитет ${capacity} Wh`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function OwnedDeviceList({
  state,
  open = null,
  onRetry,
}: {
  state: DevicesState;
  /** The device whose „Свързване“ starts open, e.g. the one just added. */
  open?: string | null;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <p className="muted" aria-busy="true">
        Зареждане на устройствата…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="notice" data-tone="bad" role="alert">
        <span>Устройствата не се заредиха. {registryErrorText(state.error)}</span>
        <button type="button" className="button-small" onClick={onRetry}>
          Опитай отново
        </button>
      </div>
    );
  }
  if (state.devices.length === 0) {
    return <p className="muted">Още няма устройства. Добавете първото с формата „Добави устройство“.</p>;
  }
  return (
    <ul className="owned-list">
      {state.devices.map((device) => {
        const limits = limitsText(device);
        return (
          <li key={device.id} className="owned-item">
            <div>
              <h3>
                {device.name}
                {device.source === "simulator" && <span className="tag">Симулирано</span>}
              </h3>
              <p className="muted">
                {KIND_LABELS[device.kind]} ·{" "}
                {device.capabilities.length
                  ? device.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(", ")
                  : "без възможности"}
                {limits && ` · ${limits}`}
              </p>
            </div>
            <details className="connect-details" open={device.id === open || undefined}>
              <summary>Свързване</summary>
              <DeviceConnectPanel device={device} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

const PLACED = ["name", "kind", "source", "capabilities", "limits.min_power_w", "limits.max_power_w", "limits.capacity_wh", "limits", ""];

export function DeviceForm({
  values,
  errors = {},
  failure = null,
  busy = false,
  onChange,
  onSubmit,
}: {
  values: DeviceFormValues;
  errors?: FieldErrors;
  failure?: string | null;
  busy?: boolean;
  onChange: (values: DeviceFormValues) => void;
  onSubmit: () => void;
}) {
  const set = (field: "name" | "minPowerW" | "maxPowerW" | "capacityWh") => (event: { target: { value: string } }) =>
    onChange({ ...values, [field]: event.target.value });
  const toggle = (capability: Capability, checked: boolean) =>
    onChange({
      ...values,
      capabilities: checked
        ? [...values.capabilities, capability]
        : values.capabilities.filter((item) => item !== capability),
    });
  // A rule on the whole body is DeviceCreate's minimum-not-above-maximum check, so it belongs with the limits.
  const limitsError = [errors[""], errors.limits].filter(Boolean).join(" ") || undefined;
  const rest = otherErrors(errors, PLACED);

  return (
    <form
      className="form"
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
            placeholder="Например: Пералня"
            {...invalid("device-name-error", errors.name)}
          />
          <FieldError id="device-name-error" message={errors.name} />
        </label>
        <label className="field">
          Вид
          <select
            name="kind"
            value={values.kind}
            onChange={(event) => onChange(withKind(values, event.target.value as DeviceKind))}
            {...invalid("device-kind-error", errors.kind)}
          >
            {DEVICE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <FieldError id="device-kind-error" message={errors.kind} />
        </label>
        <label className="field">
          Източник
          <select
            name="source"
            value={values.source}
            onChange={(event) => onChange({ ...values, source: event.target.value as DeviceSource })}
            {...invalid("device-source-error", errors.source)}
          >
            {(Object.keys(SOURCE_LABELS) as DeviceSource[]).map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
          <FieldError id="device-source-error" message={errors.source} />
        </label>
      </div>

      <fieldset className="field-group" {...invalid("device-capabilities-error", errors.capabilities)}>
        <legend>Възможности</legend>
        <div className="checks">
          {CAPABILITIES.map((capability) => (
            <label key={capability} className="check">
              <input
                type="checkbox"
                name="capabilities"
                value={capability}
                checked={values.capabilities.includes(capability)}
                onChange={(event) => toggle(capability, event.target.checked)}
              />
              {CAPABILITY_LABELS[capability]}
            </label>
          ))}
        </div>
        <span className="field-hint">Отметнати са тези на демо устройствата от същия вид.</span>
        <FieldError id="device-capabilities-error" message={errors.capabilities} />
      </fieldset>

      <fieldset className="field-group" {...invalid("device-limits-error", limitsError)}>
        <legend>Граници (по избор)</legend>
        <div className="form-row">
          <label className="field">
            Минимална мощност, W
            <input
              name="min_power_w"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={values.minPowerW}
              onChange={set("minPowerW")}
              {...invalid("device-min-error", errors["limits.min_power_w"])}
            />
            <FieldError id="device-min-error" message={errors["limits.min_power_w"]} />
          </label>
          <label className="field">
            Максимална мощност, W
            <input
              name="max_power_w"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={values.maxPowerW}
              onChange={set("maxPowerW")}
              {...invalid("device-max-error", errors["limits.max_power_w"])}
            />
            <FieldError id="device-max-error" message={errors["limits.max_power_w"]} />
          </label>
          {hasCapacity(values.kind) && (
            <label className="field">
              Капацитет, Wh
              <input
                name="capacity_wh"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={values.capacityWh}
                onChange={set("capacityWh")}
                {...invalid("device-capacity-error", errors["limits.capacity_wh"])}
              />
              <FieldError id="device-capacity-error" message={errors["limits.capacity_wh"]} />
            </label>
          )}
        </div>
        <span className="field-hint">Командите към устройството се проверяват спрямо тях. Празно поле: без граница.</span>
        <FieldError id="device-limits-error" message={limitsError} />
      </fieldset>

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
          {busy ? "Добавяне…" : "Добави устройството"}
        </button>
      </div>
    </form>
  );
}

export function OwnedSite({ siteId }: { siteId: string }) {
  const { state: auth, accessToken } = useAuth();
  const { state: sites } = useMySites();
  const signedIn = auth.status === "signed-in";
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; state: DevicesState } | null>(null);
  const [values, setValues] = useState<DeviceFormValues>(() => initialDeviceForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<OwnedDevice | null>(null);
  const key = signedIn ? `${siteId}:${version}` : null;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await accessToken();
        if (!token) throw new RegistryError(401, "Not signed in");
        const devices = await registry.devices(token, siteId, controller.signal);
        if (!controller.signal.aborted) setLoaded({ key, state: { status: "ready", devices } });
      } catch (error) {
        if (!controller.signal.aborted) setLoaded({ key, state: { status: "failed", error } });
      }
    })();
    return () => controller.abort();
  }, [key, siteId, accessToken]);

  if (!signedIn) return <SignInGate auth={auth} what="Устройствата на обекта и как да ги свържете се виждат след вход." />;

  const devices: DevicesState = loaded?.key === key ? loaded.state : { status: "loading" };
  const site = sites.status === "ready" ? sites.sites.find((item) => item.id === siteId) : undefined;
  const missing =
    (sites.status === "ready" && !site) ||
    (devices.status === "failed" && devices.error instanceof RegistryError && devices.error.status === 404);

  if (missing) {
    return (
      <section className="empty-state">
        <h1>Обектът не е намерен</h1>
        <p>Не е сред вашите обекти. Може връзката да е грешна или обектът да е на друг потребител.</p>
        <Link className="button" href="/my-sites">
          Към моите обекти
        </Link>
      </section>
    );
  }

  async function addDevice() {
    setBusy(true);
    setErrors({});
    setFailure(null);
    setAdded(null);
    try {
      const token = await accessToken();
      if (!token) throw new RegistryError(401, "Not signed in");
      const device = await registry.createDevice(token, siteId, deviceBody(values));
      setLoaded((current) =>
        current?.state.status === "ready"
          ? { ...current, state: { status: "ready", devices: [...current.state.devices, device].sort(byName) } }
          : current,
      );
      setAdded(device);
      setValues(initialDeviceForm(values.kind));
    } catch (error) {
      if (error instanceof RegistryError && error.status === 422) setErrors(error.fields);
      setFailure(registryErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="eyebrow" aria-label="Навигационна пътека">
            <Link href="/my-sites">Моите обекти</Link>
            <span aria-hidden="true">/</span>
            <span>{site ? `${site.timezone.replace("_", " ")} · ${site.currency}` : "…"}</span>
          </nav>
          <h1>{site?.name ?? "Обект"}</h1>
        </div>
        <div className="head-actions">
          <Link className="button" href={`/sites/${siteId}`}>
            Табло на живо
          </Link>
        </div>
      </div>
      <div className="stack">
        <section className="panel" aria-labelledby="devices-title">
          <div className="panel-head">
            <h2 id="devices-title">Устройства</h2>
            <span className="muted">„Свързване“: какво трябва на устройството, за да изпраща данни</span>
          </div>
          {added && (
            <p className="notice" data-tone="info" role="status">
              „{added.name}“ е добавено. На таблото е „не на линия“, докато не изпрати първата телеметрия.
            </p>
          )}
          <OwnedDeviceList state={devices} open={added?.id ?? null} onRetry={() => setVersion((current) => current + 1)} />
        </section>
        <section className="panel" aria-labelledby="add-device-title">
          <div className="panel-head">
            <h2 id="add-device-title">Добави устройство</h2>
            <span className="muted">Устройството се появява на таблото веднага, „не на линия“</span>
          </div>
          <DeviceForm
            values={values}
            errors={errors}
            failure={failure}
            busy={busy}
            onChange={setValues}
            onSubmit={() => void addDevice()}
          />
        </section>
      </div>
    </>
  );
}
