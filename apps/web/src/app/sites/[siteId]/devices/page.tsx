import type { Metadata } from "next";
import { SiteDevices } from "@/components/site-devices";

export const metadata: Metadata = { title: "Устройства" };

export default function SiteDevicesPage() {
  return <SiteDevices />;
}
