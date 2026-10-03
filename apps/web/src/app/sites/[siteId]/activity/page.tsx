import type { Metadata } from "next";
import { SiteActivity } from "@/components/site-activity";

export const metadata: Metadata = { title: "Activity" };

export default function SiteActivityPage() {
  return <SiteActivity />;
}
