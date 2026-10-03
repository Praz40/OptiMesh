import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { homeDevices, homeLive } from "@/lib/assist.fixtures";
import { DeviceList } from "./device-list";
import { ModeNotice } from "./mode-notice";
import { ModeSwitch } from "./mode-switch";

const radios = (html: string) => html.match(/<button[^>]*role="radio"[^>]*>[^<]*<\/button>/g) ?? [];

describe("ModeSwitch", () => {
  it("offers Monitor, Assist and a disabled Autopilot that points to the simulator", () => {
    const html = renderToStaticMarkup(<ModeSwitch mode="monitor" onSelect={() => undefined} />);
    const [monitor, assist, autopilot] = radios(html);
    expect(radios(html)).toHaveLength(3);
    expect(monitor).toMatch(/aria-checked="true"[^>]*>Наблюдение</);
    expect(assist).toMatch(/aria-checked="false"[^>]*>Асистент</);
    expect(autopilot).toMatch(/disabled=""[^>]*>Автопилот</);
    expect(monitor).not.toContain("disabled");
    expect(html).toContain('Автопилотът работи само в <a href="/simulator">симулатора</a>.');
  });

  it("marks Assist when it is the mode", () => {
    const [, assist] = radios(renderToStaticMarkup(<ModeSwitch mode="assist" onSelect={() => undefined} />));
    expect(assist).toContain('aria-checked="true"');
  });
});

describe("Monitor mode", () => {
  it("renders every device control disabled and no power-limit form", () => {
    const html = renderToStaticMarkup(
      <DeviceList devices={homeDevices} live={homeLive} commands={{}} send={() => Promise.reject(new Error("sent"))} readOnly />,
    );
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.includes("disabled"))).toBe(true);
    expect(html).not.toContain("<form");
  });

  it("says why nothing can be changed, and says nothing in Assist", () => {
    expect(renderToStaticMarkup(<ModeNotice mode="monitor" />)).toContain("Режим „Наблюдение“: само за четене");
    expect(renderToStaticMarkup(<ModeNotice mode="assist" />)).toBe("");
  });
});
