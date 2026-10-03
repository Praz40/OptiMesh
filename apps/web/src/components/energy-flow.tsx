import { BatteryGlyph, BuildingGlyph, EvGlyph, GridGlyph, SolarGlyph } from "@/components/icons";
import type { SiteSummary } from "@/lib/api";
import { flowsFor, formatPercent, formatPower, type Flow, type FlowNode } from "@/lib/energy";

type NodeSpec = {
  x: number;
  y: number;
  label: string;
  color: string;
  labelAt: "below" | "right";
};

const HUB = { x: 320, y: 196 };
const NODE_RADIUS = 34;
const HUB_RADIUS = 9;

const NODES: Record<FlowNode, NodeSpec> = {
  solar: { x: 320, y: 52, label: "Слънце", color: "var(--solar)", labelAt: "right" },
  grid: { x: 88, y: 196, label: "Мрежа", color: "var(--grid)", labelAt: "below" },
  home: { x: 552, y: 196, label: "Товари", color: "var(--consumption)", labelAt: "below" },
  battery: { x: 196, y: 330, label: "Батерия", color: "var(--battery)", labelAt: "below" },
  ev: { x: 444, y: 330, label: "Коли", color: "var(--ev)", labelAt: "below" },
};

function Icon({ node, soc }: { node: FlowNode; soc: number | null }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g {...common}>
      {node === "solar" && <SolarGlyph />}
      {node === "grid" && <GridGlyph />}
      {node === "battery" && <BatteryGlyph level={soc ?? 0} />}
      {node === "ev" && <EvGlyph />}
      {node === "home" && <BuildingGlyph />}
    </g>
  );
}

function caption(node: FlowNode, flow: Flow): string {
  if (flow.watts === null) return "Няма данни";
  if (node === "grid") return flow.direction === "in" ? "Подава" : flow.direction === "out" ? "Приема" : "В баланс";
  if (node === "battery") return flow.direction === "in" ? "Разрежда" : flow.direction === "out" ? "Зарежда" : "В покой";
  if (node === "solar") return flow.direction === "idle" ? "Не произвежда" : "Произвежда";
  if (node === "ev") return flow.direction === "idle" ? "Не зареждат" : "Зареждат";
  return "Консумират";
}

/** Seconds per dot period: faster for more power, on a log scale so small loads stay visible. */
function duration(watts: number): number {
  const seconds = 1.9 - 0.45 * Math.log10(Math.max(watts, 1) / 100);
  return Math.min(Math.max(seconds, 0.4), 1.9);
}

function Branch({ node, flow, maxWatts }: { node: FlowNode; flow: Flow; maxWatts: number }) {
  const spec = NODES[node];
  const dx = HUB.x - spec.x;
  const dy = HUB.y - spec.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const nodeEdge = { x: spec.x + ux * (NODE_RADIUS + 6), y: spec.y + uy * (NODE_RADIUS + 6) };
  const hubEdge = { x: HUB.x - ux * (HUB_RADIUS + 6), y: HUB.y - uy * (HUB_RADIUS + 6) };
  const [from, to] = flow.direction === "out" ? [hubEdge, nodeEdge] : [nodeEdge, hubEdge];
  const active = flow.direction !== "idle" && flow.watts !== null;
  const width = active ? 3 + 4 * Math.min((flow.watts ?? 0) / maxWatts, 1) : 2;

  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="flow-track" strokeWidth={width} />
      {active && (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          className="flow-dots"
          stroke={spec.color}
          strokeWidth={width + 1.5}
          style={{ animationDuration: `${duration(flow.watts ?? 0)}s` }}
        />
      )}
    </g>
  );
}

function NodeView({ node, flow, soc }: { node: FlowNode; flow: Flow; soc: number | null }) {
  const spec = NODES[node];
  const active = flow.direction !== "idle";
  const textX = spec.labelAt === "right" ? spec.x + NODE_RADIUS + 14 : spec.x;
  const textY = spec.labelAt === "right" ? spec.y - 8 : spec.y + NODE_RADIUS + 22;
  const anchor = spec.labelAt === "right" ? "start" : "middle";
  const value = node === "battery" && soc !== null ? `${formatPower(flow.watts)} · ${formatPercent(soc)}` : formatPower(flow.watts);
  return (
    <g className="flow-node" data-active={active}>
      <circle cx={spec.x} cy={spec.y} r={NODE_RADIUS} className="flow-node-ring" stroke={spec.color} />
      <g transform={`translate(${spec.x - 15} ${spec.y - 15}) scale(1.25)`} style={{ color: spec.color }}>
        <Icon node={node} soc={soc} />
      </g>
      <text x={textX} y={textY} textAnchor={anchor} className="flow-value">
        {value}
      </text>
      <text x={textX} y={textY + 20} textAnchor={anchor} className="flow-label">
        {spec.label} · {caption(node, flow)}
      </text>
    </g>
  );
}

/** `present` lists the branches this site has equipment for; others are not drawn. */
export function EnergyFlow({ summary, present }: { summary: SiteSummary; present: ReadonlySet<FlowNode> }) {
  const flows = flowsFor(summary);
  const order = (["solar", "grid", "home", "battery", "ev"] as FlowNode[]).filter(
    (node) => node === "home" || present.has(node),
  );
  const maxWatts = Math.max(1000, ...order.map((node) => flows[node].watts ?? 0));
  const description = order
    .map((node) => `${NODES[node].label}: ${caption(node, flows[node]).toLowerCase()} ${formatPower(flows[node].watts)}`)
    .join("; ");

  return (
    <svg className="energy-flow" viewBox="0 0 640 420" role="img" aria-label={`Поток на енергията. ${description}`}>
      {order.map((node) => (
        <Branch key={node} node={node} flow={flows[node]} maxWatts={maxWatts} />
      ))}
      <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS + 5} className="flow-hub-ring" />
      <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS - 3} className="flow-hub" />
      {order.map((node) => (
        <NodeView key={node} node={node} flow={flows[node]} soc={summary.battery_soc_pct} />
      ))}
    </svg>
  );
}
