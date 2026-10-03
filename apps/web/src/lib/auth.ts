/** Supabase Auth settings for the browser. Both values are public by design; never put a service-role key here. */
export type AuthConfig = { url: string; key: string };

/**
 * Sign-in is optional. Without both values the sign-in screens stay hidden and the app works as before.
 * Next.js inlines NEXT_PUBLIC_ values only where they are written out literally, as here.
 */
export function authConfig(): AuthConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: "Грешен имейл или парола.",
  user_already_exists: "Вече има профил с този имейл. Влезте с него.",
  email_exists: "Вече има профил с този имейл. Влезте с него.",
  weak_password: "Паролата е твърде слаба. Изберете по-дълга парола.",
  email_not_confirmed: "Имейлът още не е потвърден. Отворете връзката от писмото.",
  email_address_invalid: "Невалиден имейл адрес.",
  validation_failed: "Проверете имейла и паролата.",
  signup_disabled: "Регистрацията е изключена в проекта на Supabase.",
  email_provider_disabled: "Входът с имейл е изключен в проекта на Supabase.",
  over_request_rate_limit: "Твърде много опити. Опитайте отново след малко.",
  over_email_send_rate_limit: "Твърде много писма за кратко време. Опитайте отново след малко.",
};

/**
 * One Bulgarian sentence for a failed sign-in, sign-up or sign-out. Reads `name` and `code` instead of
 * importing supabase-js, so the library is only downloaded when sign-in is configured.
 */
export function authErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const { name, code } = error as { name?: unknown; code?: unknown };
    // supabase-js reports an unreachable Auth server as AuthRetryableFetchError.
    if (name === "AuthRetryableFetchError") return "Няма връзка със Supabase. Входът изисква интернет.";
    if (typeof code === "string" && code in AUTH_ERRORS) return AUTH_ERRORS[code];
  }
  return "Входът не успя. Опитайте отново.";
}
