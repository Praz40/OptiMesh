import type { Metadata } from "next";
import { SiteActivity } from "@/components/site-activity";

export const metadata: Metadata = { title: "Активност" };

export default function SiteActivityPage() {
  return <SiteActivity />;
}
