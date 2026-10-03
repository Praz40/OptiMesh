import type { Metadata } from "next";
import { SiteCosts } from "@/components/site-costs";

export const metadata: Metadata = { title: "Разходи" };

export default function SiteCostsPage() {
  return <SiteCosts />;
}
