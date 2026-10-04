import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/hooks/use-auth";
import { MySitesProvider } from "@/hooks/use-my-sites";
import { SitesProvider } from "@/hooks/use-sites";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OptiMesh", template: "%s · OptiMesh" },
  description: "Управление на енергията за свързани домове и бизнеси.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151917" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bg">
      <body>
        <SitesProvider>
          {/* Both do nothing unless sign-in is configured (NEXT_PUBLIC_SUPABASE_URL and _PUBLISHABLE_KEY). */}
          <AuthProvider>
            <MySitesProvider>
              <AppShell>{children}</AppShell>
            </MySitesProvider>
          </AuthProvider>
        </SitesProvider>
      </body>
    </html>
  );
}
