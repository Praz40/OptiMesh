import type { Capability, Command, CommandRequest, CommandStatus, Device, DeviceLive, Recommendation } from "./api";
import { formatPowerBg } from "./format";

/** Recommendations change with the live balance, but slowly; the API caches the load profile for 5 min. */
export const RECOMMENDATIONS_POLL_MS = 60_000;

/** What the command does, in words: "лимит 4,9 kW", "включване". */
export function describeAction(action: CommandRequest): string {
  if (action.type === "switch") return action.params.on ? "включване" : "изключване";
  return action.params.power_w === 0 ? "спиране" : `лимит ${formatPowerBg(action.params.power_w)}`;
}

export function requiredCapability(action: CommandRequest): Capability {
  return action.type === "switch" ? "switch" : "power_setpoint";
}

/** Why "Приложи" cannot be pressed for this recommendation right now, or null when it can. */
export function applyBlocker(
  recommendation: Recommendation,
  device: Device | undefined,
  live: DeviceLive | undefined,
): string | null {
  if (!device) return "Устройството вече не е в обекта.";
  if (!device.capabilities.includes(requiredCapability(recommendation.action))) {
    return "Устройството не поддържа тази команда.";
  }
  if (!live?.online) return "Устройството не е на линия.";
  return null;
}

export type StatusView = { tone: "busy" | "good" | "bad"; text: string; final: boolean };

const STATUS_TEXT: Record<CommandStatus, string> = {
  pending: "Изпраща се…",
  sent: "Изпратено, чака потвърждение от устройството…",
  applied: "Приложено: устройството потвърди.",
  rejected: "Отказано от устройството",
  expired: "Устройството не отговори навреме.",
  failed: "Не можа да се изпрати до устройството.",
};

/** What a recommendation row shows for the command its "Приложи" created. */
export function statusView(command: Command | undefined, error?: string): StatusView | null {
  if (error) return { tone: "bad", text: `Не е изпратено: ${error}`, final: true };
  if (!command) return null;
  const { status } = command;
  const final = status !== "pending" && status !== "sent";
  const tone = status === "applied" ? "good" : final ? "bad" : "busy";
  const reason = status === "rejected" && command.reason ? `: ${command.reason}` : status === "rejected" ? "." : "";
  return { tone, text: `${STATUS_TEXT[status]}${reason}`, final };
}

/**
 * A command on the same device created after the applied one and not sent by "Приложи":
 * someone changed the device by hand (or the device list) after the recommendation.
 */
export function manualOverride(
  applied: Command | undefined,
  latestOnDevice: Command | undefined,
  appliedIds: ReadonlySet<string>,
): Command | null {
  if (!applied || !latestOnDevice || appliedIds.has(latestOnDevice.id)) return null;
  return latestOnDevice.created_at > applied.created_at ? latestOnDevice : null;
}

type Send = (deviceId: string, body: CommandRequest) => Promise<Command>;

/** Sends exactly the recommended command to the recommended device, nothing else. */
export function applyRecommendation(recommendation: Recommendation, send: Send): Promise<Command> {
  return send(recommendation.device_id, recommendation.action);
}
