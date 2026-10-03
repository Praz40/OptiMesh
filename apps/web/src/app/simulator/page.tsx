import type { Metadata } from "next";
import { SimulatorGame } from "@/components/simulator/simulator-game";
import "./simulator.css";

export const metadata: Metadata = {
  title: "Симулатор",
  description: "Управлявайте ръчно един ден в офиса, после го сравнете с Автопилота в същия сценарий.",
};

export default function SimulatorPage() {
  return <SimulatorGame />;
}
