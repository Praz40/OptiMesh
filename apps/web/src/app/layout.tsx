import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { SitesProvider } from "@/hooks/use-sites";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OptiMesh", template: "%s · OptiMesh" },
  description: "Energy management for connected homes and businesses.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151917" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SitesProvider>
          <AppShell>{children}</AppShell>
        </SitesProvider>
      </body>
    </html>
  );
}
