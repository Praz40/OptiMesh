import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignIn } from "@/components/sign-in";
import { authConfig } from "@/lib/auth";

export const metadata: Metadata = { title: "Вход" };

export default function SignInPage() {
  // Without the two NEXT_PUBLIC_SUPABASE_ values sign-in does not exist, as before.
  if (!authConfig()) notFound();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Вход</h1>
          <p className="muted">С профил създавате свои обекти, добавяте устройства и виждате как да ги свържете.</p>
        </div>
      </div>
      <SignIn />
    </>
  );
}
