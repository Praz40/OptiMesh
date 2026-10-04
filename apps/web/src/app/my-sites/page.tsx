import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MySites } from "@/components/my-sites";
import { authConfig } from "@/lib/auth";

export const metadata: Metadata = { title: "Моите обекти" };

export default function MySitesPage() {
  if (!authConfig()) notFound();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Моите обекти</h1>
          <p className="muted">Обектите, които сте създали. Всеки има свои устройства и табло на живо.</p>
        </div>
      </div>
      <MySites />
    </>
  );
}
