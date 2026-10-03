"use client";

import Link from "next/link";
import { useId } from "react";
import type { SiteMode } from "@/lib/site-mode";

export const MODES: { mode: SiteMode; label: string; hint: string }[] = [
  { mode: "monitor", label: "Наблюдение", hint: "Само за четене: команди не се изпращат." },
  { mode: "assist", label: "Асистент", hint: "Препоръки, които прилагате с „Приложи“; ръчното управление е достъпно." },
  { mode: "autopilot", label: "Автопилот", hint: "Изключен за реални обекти." },
];

/** Monitor / Assist / Autopilot for one site. Autopilot is shown but cannot be chosen on real sites. */
export function ModeSwitch({ mode, onSelect }: { mode: SiteMode; onSelect: (mode: SiteMode) => void }) {
  const noteId = useId();
  return (
    <div className="mode">
      {/* Toggle buttons rather than radios: a radiogroup would need roving focus and arrow keys. */}
      <div className="mode-switch" role="group" aria-label="Режим на управление">
        {MODES.map((item) => {
          const autopilot = item.mode === "autopilot";
          return (
            <button
              key={item.mode}
              type="button"
              aria-pressed={mode === item.mode}
              disabled={autopilot}
              aria-describedby={autopilot ? noteId : undefined}
              title={item.hint}
              onClick={() => onSelect(item.mode)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <p className="mode-note" id={noteId}>
        Автопилотът работи само в <Link href="/simulator">симулатора</Link>.
      </p>
    </div>
  );
}
