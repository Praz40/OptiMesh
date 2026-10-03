import { notFound } from "next/navigation";
import { SiteDashboard } from "@/components/site-dashboard";
import { isUuid } from "@/lib/api";

export default async function SitePage({ params }: PageProps<"/sites/[siteId]">) {
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  return <SiteDashboard siteId={siteId} />;
}
