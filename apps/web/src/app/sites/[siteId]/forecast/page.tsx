import type { Metadata } from "next";
import { SiteForecast } from "@/components/site-forecast";

export const metadata: Metadata = { title: "Прогноза" };

export default function SiteForecastPage() {
  return <SiteForecast />;
}
