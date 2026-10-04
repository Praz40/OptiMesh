import type { Command, Device } from "@/lib/api";
import { COMMAND_LABELS, formatClock, formatPower } from "@/lib/energy";

export function describeCommand(command: Pick<Command, "type" | "params">): string {
  if (command.type === "switch") return command.params.on ? "Включване" : "Изключване";
  const watts = Number(command.params.power_w);
  return watts === 0 ? "Спиране" : `Лимит ${formatPower(watts)}`;
}

/** Commands newest first. "Applied" only appears once the device acknowledged it. */
export function CommandLog({ commands, devices }: { commands: Command[]; devices: Device[] }) {
  const names = new Map(devices.map((device) => [device.id, device.name]));
  if (commands.length === 0) {
    return <p className="muted">Още няма команди. Тук се появяват командите от управлението на устройствата и приложените препоръки.</p>;
  }
  return (
    <ol className="command-log">
      {commands.map((command) => (
        <li key={command.id}>
          <time dateTime={command.created_at}>{formatClock(command.created_at, true)}</time>
          <span>
            {names.get(command.device_id) ?? "Непознато устройство"} · {describeCommand(command)}
            {command.reason && <span className="command-reason">{command.reason}</span>}
          </span>
          <span className="command-status" data-status={command.status}>
            {COMMAND_LABELS[command.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function sortedCommands(commands: Record<string, Command>, limit?: number): Command[] {
  const sorted = Object.values(commands).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
