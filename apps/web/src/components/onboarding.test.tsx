import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { DEVICE_KINDS, RegistryError, fieldErrors, initialDeviceForm, type OwnedDevice, type OwnedSite } from "@/lib/registry";
import { DEVICE_422, DEVICE_MIN_ABOVE_MAX_422, SITE_422 } from "@/lib/registry.fixtures";
import { AccountPanel, MySitesLink } from "./account";
import { DeviceConnect } from "./device-connect";
import { MySitesList, NEW_SITE, SiteForm, SignInGate } from "./my-sites";
import { DeviceForm, OwnedDeviceList } from "./owned-site";
import { SignInForm } from "./sign-in";

const noop = () => undefined;
const SIGNED_IN: AuthState = { status: "signed-in", userId: "u1", email: "yordan@example.com" };

const SITE: OwnedSite = {
  id: "5e000000-0000-4000-8000-000000000009",
  owner_id: "0a000000-0000-4000-8000-000000000001",
  name: "Офис",
  timezone: "Europe/Sofia",
  currency: "EUR",
  created_at: "2026-10-04T08:00:00Z",
};

const PLUG: OwnedDevice = {
  id: "de000000-0000-4000-8000-000000009001",
  site_id: SITE.id,
  name: "Пералня",
  kind: "smart_plug",
  source: "simulator",
  capabilities: ["measure_power", "switch"],
  limits: { max_power_w: 2300 },
  created_at: "2026-10-04T08:05:00Z",
};

/** The text right after an input's label up to the next label, to check that an error sits under its field. */
function fieldHtml(html: string, name: string): string {
  const start = html.lastIndexOf("<label", html.indexOf(`name="${name}"`));
  return html.slice(start, html.indexOf("</label>", start));
}

describe("hidden when sign-in is not configured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("answers 404 on the new pages", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const pages = [
      (await import("@/app/sign-in/page")).default,
      (await import("@/app/my-sites/page")).default,
    ];
    for (const page of pages) expect(() => page()).toThrow(expect.objectContaining({ digest: expect.stringContaining("404") }));
    const owned = (await import("@/app/my-sites/[siteId]/page")).default;
    await expect(owned({ params: Promise.resolve({ siteId: SITE.id }) } as never)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("renders the pages when both values are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    expect((await import("@/app/sign-in/page")).default()).toBeTruthy();
    expect((await import("@/app/my-sites/page")).default()).toBeTruthy();
    const owned = (await import("@/app/my-sites/[siteId]/page")).default;
    await expect(owned({ params: Promise.resolve({ siteId: SITE.id }) } as never)).resolves.toMatchObject({
      props: { siteId: SITE.id },
    });
  });

  it("keeps the providers inert and adds nothing to the sidebar", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { AuthProvider, useAuth } = await import("@/hooks/use-auth");
    const { MySitesProvider, useMySites } = await import("@/hooks/use-my-sites");
    const { AppShell } = await import("@/components/app-shell");
    function Probe() {
      return <i>{`${useAuth().state.status}/${useMySites().state.status}`}</i>;
    }
    const html = renderToStaticMarkup(
      <AuthProvider>
        <MySitesProvider>
          <Probe />
          <AppShell>page</AppShell>
        </MySitesProvider>
      </AuthProvider>,
    );
    expect(html).toContain("<i>disabled/signed-out</i>");
    expect(html).not.toContain("Моите обекти");
    expect(html).not.toContain("Вход");
    expect(html).not.toContain('class="account"');
    expect(html).toContain("Портфолио");
  });

  it("starts as loading, not signed out, when configured, so nothing flashes before the session is read", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const { AuthProvider, useAuth } = await import("@/hooks/use-auth");
    function Probe() {
      return <i>{useAuth().state.status}</i>;
    }
    expect(renderToStaticMarkup(<AuthProvider><Probe /></AuthProvider>)).toBe("<i>loading</i>");
  });
});

describe("sidebar", () => {
  it("shows „Моите обекти“ only to a signed-in user", () => {
    expect(renderToStaticMarkup(<MySitesLink auth={{ status: "signed-out" }} pathname="/" />)).toBe("");
    expect(renderToStaticMarkup(<MySitesLink auth={{ status: "disabled" }} pathname="/" />)).toBe("");
    const link = renderToStaticMarkup(<MySitesLink auth={SIGNED_IN} pathname="/my-sites" />);
    expect(link).toContain('href="/my-sites"');
    expect(link).toContain('aria-current="page"');
    expect(link).toContain("Моите обекти");
  });

  it("offers „Вход“ when signed out and „Изход“ with the email when signed in", () => {
    expect(renderToStaticMarkup(<AccountPanel auth={{ status: "disabled" }} onSignOut={noop} />)).toBe("");
    expect(renderToStaticMarkup(<AccountPanel auth={{ status: "loading" }} onSignOut={noop} />)).toContain("Проверка на входа…");
    const out = renderToStaticMarkup(<AccountPanel auth={{ status: "signed-out" }} onSignOut={noop} />);
    expect(out).toContain('<a class="button button-small" href="/sign-in">Вход</a>');
    const signedIn = renderToStaticMarkup(<AccountPanel auth={SIGNED_IN} onSignOut={noop} error="Няма връзка със Supabase. Входът изисква интернет." />);
    expect(signedIn).toContain("yordan@example.com");
    expect(signedIn).toMatch(/<button[^>]*>Изход<\/button>/);
    expect(signedIn).toContain('role="alert">Няма връзка със Supabase. Входът изисква интернет.');
  });
});

describe("SignInForm", () => {
  it("switches between sign-in and sign-up and asks for email and password", () => {
    const signIn = renderToStaticMarkup(<SignInForm mode="sign-in" onMode={noop} onSubmit={noop} />);
    expect(signIn).toMatch(/aria-pressed="true"[^>]*>Вход</);
    expect(signIn).toContain('type="email"');
    expect(signIn).toContain('autoComplete="current-password"');
    expect(signIn).toMatch(/type="submit"[^>]*>Влез</);
    const signUp = renderToStaticMarkup(<SignInForm mode="sign-up" onMode={noop} onSubmit={noop} />);
    expect(signUp).toMatch(/aria-pressed="true"[^>]*>Регистрация</);
    expect(signUp).toContain('autoComplete="new-password"');
    expect(signUp).toContain('minLength="6"');
    expect(signUp).toMatch(/type="submit"[^>]*>Създай профил</);
  });

  it("shows an error, a notice and a busy button", () => {
    const html = renderToStaticMarkup(
      <SignInForm mode="sign-in" busy error="Грешен имейл или парола." notice="Профилът е създаден." onMode={noop} onSubmit={noop} />,
    );
    expect(html).toContain('role="alert">Грешен имейл или парола.');
    expect(html).toContain('role="status">Профилът е създаден.');
    expect(html).toMatch(/disabled=""[^>]*>Изчакване…</);
    expect(html).toContain("изисква интернет");
  });
});

describe("SignInGate", () => {
  it("asks to sign in, waits while the session loads, and steps aside once signed in", () => {
    expect(renderToStaticMarkup(<SignInGate auth={{ status: "signed-out" }} what="x" />)).toContain('href="/sign-in"');
    expect(renderToStaticMarkup(<SignInGate auth={{ status: "loading" }} what="x" />)).toContain("Проверка на входа…");
    expect(renderToStaticMarkup(<SignInGate auth={SIGNED_IN} what="x" />)).toBe("");
  });
});

describe("MySitesList", () => {
  it("shows loading, API offline, auth unavailable and empty states", () => {
    expect(renderToStaticMarkup(<MySitesList state={{ status: "loading" }} onRetry={noop} />)).toContain("Зареждане на вашите обекти…");
    const offline = renderToStaticMarkup(<MySitesList state={{ status: "failed", error: new TypeError("няма връзка с API") }} onRetry={noop} />);
    expect(offline).toContain("Обектите не се заредиха. Няма връзка с OptiMesh API.");
    expect(offline).toContain("Опитай отново");
    expect(
      renderToStaticMarkup(<MySitesList state={{ status: "failed", error: new ApiError(503, "Authentication unavailable") }} onRetry={noop} />),
    ).toContain("SUPABASE_URL");
    expect(renderToStaticMarkup(<MySitesList state={{ status: "ready", sites: [] }} onRetry={noop} />)).toContain("Още нямате обекти");
  });

  it("links each site to its live dashboard and to its devices", () => {
    const html = renderToStaticMarkup(<MySitesList state={{ status: "ready", sites: [SITE] }} onRetry={noop} />);
    expect(html).toContain(`<a href="/sites/${SITE.id}">Офис</a>`);
    expect(html).toContain(`href="/my-sites/${SITE.id}">Устройства и свързване</a>`);
    expect(html).toContain(`href="/sites/${SITE.id}">Табло</a>`);
    expect(html).toContain("Europe/Sofia · EUR");
  });
});

describe("SiteForm", () => {
  it("starts with Europe/Sofia and EUR", () => {
    const html = renderToStaticMarkup(<SiteForm values={NEW_SITE} onChange={noop} onSubmit={noop} />);
    expect(fieldHtml(html, "timezone")).toContain('value="Europe/Sofia"');
    expect(fieldHtml(html, "currency")).toContain('value="EUR"');
    expect(html).toMatch(/type="submit"[^>]*>Създай обекта</);
  });

  it("shows each 422 message under its own field", () => {
    const html = renderToStaticMarkup(
      <SiteForm values={NEW_SITE} errors={fieldErrors(SITE_422.detail)} failure="Проверете отбелязаните полета." onChange={noop} onSubmit={noop} />,
    );
    expect(fieldHtml(html, "name")).toContain('aria-invalid="true" aria-describedby="site-name-error"');
    expect(fieldHtml(html, "name")).toContain('id="site-name-error">String should have at least 1 character');
    expect(fieldHtml(html, "timezone")).toContain(">Use a valid IANA timezone<");
    expect(fieldHtml(html, "currency")).toContain(">String should match pattern &#x27;^[A-Z]{3}$&#x27;<");
    expect(html).toContain('role="alert">Проверете отбелязаните полета.');
  });
});

describe("DeviceForm", () => {
  const render = (props: Partial<Parameters<typeof DeviceForm>[0]> = {}) =>
    renderToStaticMarkup(<DeviceForm values={initialDeviceForm()} onChange={noop} onSubmit={noop} {...props} />);

  it("offers every kind with its Bulgarian label, both sources and the capabilities with defaults", () => {
    const html = render();
    const kinds = [...html.matchAll(/<option value="([a-z_]+)"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(kinds.filter((kind) => DEVICE_KINDS.includes(kind as never))).toEqual(DEVICE_KINDS);
    expect(html).toContain('<option value="smart_plug" selected="">Смарт контакт</option>');
    expect(html).toContain('<option value="hardware" selected="">Истинско устройство</option>');
    expect(html).toContain('<option value="simulator">Симулатор</option>');
    expect(html).toContain('checked="" value="measure_power"');
    expect(html).toContain('checked="" value="switch"');
    expect(html).toContain('<input type="checkbox" name="capabilities" value="charging"/>');
    expect(html).not.toContain('name="capacity_wh"');
    expect(render({ values: initialDeviceForm("battery") })).toContain('name="capacity_wh"');
  });

  it("shows each 422 message next to its field", () => {
    const html = render({ values: initialDeviceForm("battery"), errors: fieldErrors(DEVICE_422.detail) });
    expect(fieldHtml(html, "name")).toContain("String should have at least 1 character");
    expect(fieldHtml(html, "kind")).toContain("Input should be &#x27;grid_meter&#x27;");
    expect(fieldHtml(html, "source")).toContain("Input should be &#x27;hardware&#x27; or &#x27;simulator&#x27;");
    expect(fieldHtml(html, "max_power_w")).toContain('id="device-max-error">Input should be greater than 0');
    expect(fieldHtml(html, "capacity_wh")).toContain('id="device-capacity-error">Input should be greater than 0');
    expect(fieldHtml(html, "min_power_w")).not.toContain("field-error");
    expect(html).toContain('id="device-capabilities-error">Input should be &#x27;measure_power&#x27;');
  });

  it("puts the minimum-above-maximum rule with the limits, and lists anything unplaced", () => {
    const html = render({ errors: fieldErrors(DEVICE_MIN_ABOVE_MAX_422.detail) });
    expect(html).toContain('id="device-limits-error">Minimum operating limit must not exceed maximum');
    expect(render({ errors: { "limits.voltage": "Extra inputs are not permitted" } })).toContain(
      "limits.voltage: Extra inputs are not permitted",
    );
  });

  it("shows the API failure and a busy button", () => {
    const html = render({ busy: true, failure: "Няма връзка с OptiMesh API." });
    expect(html).toContain('role="alert">Няма връзка с OptiMesh API.');
    expect(html).toMatch(/disabled=""[^>]*>Добавяне…</);
  });
});

describe("OwnedDeviceList", () => {
  it("shows loading, offline, not-found and empty states", () => {
    expect(renderToStaticMarkup(<OwnedDeviceList state={{ status: "loading" }} onRetry={noop} />)).toContain("Зареждане на устройствата…");
    expect(
      renderToStaticMarkup(<OwnedDeviceList state={{ status: "failed", error: new TypeError("x") }} onRetry={noop} />),
    ).toContain("Устройствата не се заредиха. Няма връзка с OptiMesh API.");
    expect(
      renderToStaticMarkup(<OwnedDeviceList state={{ status: "failed", error: new RegistryError(404, "Site not found") }} onRetry={noop} />),
    ).toContain("Обектът не е намерен или не е ваш.");
    expect(renderToStaticMarkup(<OwnedDeviceList state={{ status: "ready", devices: [] }} onRetry={noop} />)).toContain("Още няма устройства.");
  });

  it("lists each device with kind, capabilities, limits and a „Свързване“ section, open for the one just added", () => {
    const html = renderToStaticMarkup(<OwnedDeviceList state={{ status: "ready", devices: [PLUG] }} open={PLUG.id} onRetry={noop} />);
    expect(html).toContain('Пералня<span class="tag">Симулирано</span>');
    expect(html).toContain("Смарт контакт · Мери мощност, Включване и изключване · макс. 2300 W");
    expect(html).toContain('<details class="connect-details" open=""><summary>Свързване</summary>');
    const closed = renderToStaticMarkup(<OwnedDeviceList state={{ status: "ready", devices: [PLUG] }} onRetry={noop} />);
    expect(closed).toContain('<details class="connect-details"><summary>');
  });
});

describe("DeviceConnect", () => {
  const html = renderToStaticMarkup(
    <DeviceConnect device={PLUG} messageId="6f1c2a8e-3b7d-4c51-9a0e-2d4b8f7e1c33" observedAt={new Date("2026-10-04T08:15:30Z")} />,
  );
  const base = `optimesh/v1/sites/${PLUG.site_id}/devices/${PLUG.id}`;

  it("gives the IDs, the three topics and the ESP32 lines, each with a copy button", () => {
    expect(html).toContain(`<code>${PLUG.site_id}</code>`);
    expect(html).toContain(`<code>${PLUG.id}</code>`);
    for (const channel of ["telemetry", "command", "ack"]) expect(html).toContain(`<code>${base}/${channel}</code>`);
    expect(html).toContain(`#define SITE_ID &quot;${PLUG.site_id}&quot;\n#define DEVICE_ID &quot;${PLUG.id}&quot;`);
    expect(html.match(/>Копирай</g)).toHaveLength(7);
  });

  it("shows a telemetry example for this device", () => {
    expect(html).toContain("&quot;device_id&quot;: &quot;de000000-0000-4000-8000-000000009001&quot;");
    expect(html).toContain("&quot;observed_at&quot;: &quot;2026-10-04T08:15:30Z&quot;");
    expect(html).toContain("&quot;power_w&quot;: 60");
    expect(html).toContain("За проба без MQTT: POST /api/v1/telemetry със същото съобщение.");
  });

  it("says that the gateway broker needs an ACL and what is supported today", () => {
    expect(html).toContain("Брокерът на шлюза (Raspberry Pi) пуска устройството само ако има ACL за тези теми");
    expect(html).toContain("Днес се свързват ESP32 по Wi-Fi и симулаторът на устройства, и двата по MQTT през шлюза.");
    expect(html).toContain("Zigbee, Bluetooth и готовите смарт контакти искат адаптери в шлюза, които още не са направени (issue #18).");
    expect(html).not.toMatch(/<select|Zigbee<\/option>|протокол/i);
  });

  it("tells to restart the device simulator only for a simulated device", () => {
    expect(html).toContain("python -m app.simulator");
    const hardware = renderToStaticMarkup(<DeviceConnect device={{ ...PLUG, source: "hardware" }} messageId="x" observedAt={new Date(0)} />);
    expect(hardware).not.toContain("python -m app.simulator");
  });
});
