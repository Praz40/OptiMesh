import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OptiMesh",
  description: "Energy management for connected homes and businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
