// Bulgarian formatting (decimal comma, 24-hour clock) for the Bulgarian screens.
// The older English screens keep lib/energy.ts until they are translated.

const LOCALE = "bg-BG";

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

const numberFormats = new Map<number, Intl.NumberFormat>();

/** 3.7746 -> "3,8" with one digit. Thousands are grouped with a no-break space. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (!finite(value)) return "—";
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(digits, format);
  }
  // Avoid "-0,0" for values that round to zero.
  const rounded = Number(value.toFixed(digits));
  return format.format(rounded === 0 ? 0 : rounded);
}

/** 0.9265, "EUR" -> "0,93 €". */
export function formatMoney(value: number | null | undefined, currency: string, digits = 2): string {
  if (!finite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rounded === 0 ? 0 : rounded);
}

/** 0.19, "EUR" -> "0,19 €/kWh". */
export function formatPrice(price: number | null | undefined, currency: string): string {
  return finite(price) ? `${formatMoney(price, currency)}/kWh` : "—";
}

/** 850 -> "850 W", 1840 -> "1,8 kW", 28328 -> "28 kW". */
export function formatPowerBg(watts: number | null | undefined): string {
  if (!finite(watts)) return "—";
  const abs = Math.abs(watts);
  if (abs < 1000) return `${Math.round(watts)} W`;
  return `${formatNumber(watts / 1000, abs < 10_000 ? 1 : 0)} kW`;
}

/** Axis-friendly kW: whole numbers from 10 kW, one decimal below. */
export function formatKwBg(watts: number): string {
  const kw = watts / 1000;
  return `${formatNumber(kw, Math.abs(kw) >= 10 || kw === 0 ? 0 : 1)} kW`;
}

/** 380 -> "380 Wh", 6370 -> "6,4 kWh". */
export function formatEnergyBg(wh: number | null | undefined): string {
  if (!finite(wh)) return "—";
  const abs = Math.abs(wh);
  if (abs < 1000) return `${Math.round(wh)} Wh`;
  return `${formatNumber(wh / 1000, abs < 100_000 ? 1 : 0)} kWh`;
}

/** Wall-clock time at the site, not in the browser's zone: "10:20". An unknown zone falls back to UTC, as the API does. */
export function formatSiteTime(at: string | number, timeZone: string): string {
  const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone });
  } catch {
    format = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: "UTC" });
  }
  return format.format(new Date(at));
}

/** "10:00–11:00" in the site's zone. */
export function formatHourRange(start: string | number, end: string | number, timeZone: string): string {
  return `${formatSiteTime(start, timeZone)}–${formatSiteTime(end, timeZone)}`;
}
