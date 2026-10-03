import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfig, authErrorText } from "./auth";

describe("authConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless both public Supabase values are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(authConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    expect(authConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    expect(authConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "   ");
    expect(authConfig()).toBeNull();
  });

  it("drops a trailing slash from the project URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", " sb_publishable_x ");
    expect(authConfig()).toEqual({ url: "https://example.supabase.co", key: "sb_publishable_x" });
  });
});

describe("authErrorText", () => {
  it("translates the Supabase errors a user can cause", () => {
    expect(authErrorText(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"))).toBe(
      "Грешен имейл или парола.",
    );
    expect(authErrorText(new AuthApiError("User already registered", 422, "user_already_exists"))).toBe(
      "Вече има профил с този имейл. Влезте с него.",
    );
    expect(authErrorText(new AuthWeakPasswordError("Password is too weak", 422, ["length"]))).toBe(
      "Паролата е твърде слаба. Изберете по-дълга парола.",
    );
    expect(authErrorText(new AuthApiError("Email not confirmed", 400, "email_not_confirmed"))).toContain("не е потвърден");
    expect(authErrorText(new AuthApiError("Signups not allowed", 422, "signup_disabled"))).toContain("изключена");
  });

  it("says that sign-in needs internet when Supabase cannot be reached", () => {
    expect(authErrorText(new AuthRetryableFetchError("Failed to fetch", 0))).toBe(
      "Няма връзка със Supabase. Входът изисква интернет.",
    );
  });

  it("falls back to a general sentence", () => {
    expect(authErrorText(new AuthApiError("Database error", 500, "unexpected_failure"))).toBe(
      "Входът не успя. Опитайте отново.",
    );
    expect(authErrorText(null)).toBe("Входът не успя. Опитайте отново.");
  });
});
