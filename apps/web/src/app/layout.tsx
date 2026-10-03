import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OptiMesh",
  description: "Energy management for connected homes and businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="shell app-header-inner">
            <Link className="wordmark" href="/">
              Opti<span>Mesh</span>
            </Link>
            <nav aria-label="Main">
              <Link href="/">Sites</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
