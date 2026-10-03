import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OwnedSite } from "@/components/owned-site";
import { isUuid } from "@/lib/api";
import { authConfig } from "@/lib/auth";

export const metadata: Metadata = { title: "Устройства и свързване" };

export default async function OwnedSitePage({ params }: PageProps<"/my-sites/[siteId]">) {
  if (!authConfig()) notFound();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  return <OwnedSite key={siteId} siteId={siteId} />;
}
