import type { Metadata } from "next";
import { SimulatorGame } from "@/components/simulator/simulator-game";
import "./simulator.css";

export const metadata: Metadata = {
  title: "Simulator",
  description: "Run a day of the office by hand, then compare it with Autopilot on the same scenario.",
};

export default function SimulatorPage() {
  return <SimulatorGame />;
}
