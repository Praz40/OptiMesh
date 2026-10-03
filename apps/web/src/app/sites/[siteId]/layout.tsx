import { notFound } from "next/navigation";
import { SiteFrame } from "@/components/site-frame";
import { SiteLiveProvider } from "@/hooks/use-site-live";
import { isUuid } from "@/lib/api";

export default async function SiteLayout({ children, params }: LayoutProps<"/sites/[siteId]">) {
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  // Keyed by site: switching sites closes the old socket and starts from empty state.
  return (
    <SiteLiveProvider key={siteId} siteId={siteId}>
      <SiteFrame>{children}</SiteFrame>
    </SiteLiveProvider>
  );
}
