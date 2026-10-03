import type { Metadata } from "next";
import { SiteDevices } from "@/components/site-devices";

export const metadata: Metadata = { title: "Devices" };

export default function SiteDevicesPage() {
  return <SiteDevices />;
}
