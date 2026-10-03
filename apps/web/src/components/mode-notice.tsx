import type { SiteMode } from "@/lib/site-mode";

/** Says why the controls are read-only outside Assist. */
export function ModeNotice({ mode }: { mode: SiteMode }) {
  if (mode === "assist") return null;
  return (
    <p className="notice span-all" data-tone="info" role="status" data-mode={mode}>
      Режим „Наблюдение“: само за четене, команди не се изпращат. Изберете „Асистент“ горе, за да виждате препоръки
      и да управлявате устройствата.
    </p>
  );
}
