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
  solar: { x: 320, y: 52, label: "Solar", color: "var(--solar)", labelAt: "right" },
  grid: { x: 88, y: 196, label: "Grid", color: "var(--grid)", labelAt: "below" },
  home: { x: 552, y: 196, label: "Home & loads", color: "var(--home)", labelAt: "below" },
  battery: { x: 196, y: 330, label: "Battery", color: "var(--battery)", labelAt: "below" },
  ev: { x: 444, y: 330, label: "EV charging", color: "var(--ev)", labelAt: "below" },
};

function Icon({ node, soc }: { node: FlowNode; soc: number | null }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (node) {
    case "solar":
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="4.5" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line key={angle} x1="12" y1="2.5" x2="12" y2="4.8" transform={`rotate(${angle} 12 12)`} />
          ))}
        </g>
      );
    case "grid":
      return (
        <g {...common}>
          <path d="M8 22 12 3l4 19M9.2 16h5.6M10.2 11h3.6M5 7h14M7 7l5 4 5-4" />
        </g>
      );
    case "battery": {
      const level = Math.max(0, Math.min(1, (soc ?? 0) / 100));
      return (
        <g {...common}>
          <rect x="6" y="5" width="12" height="17" rx="2" />
          <path d="M10 2.5h4" />
          <rect x="8.2" y={7.2 + 12.6 * (1 - level)} width="7.6" height={12.6 * level} rx="0.8" fill="currentColor" stroke="none" />
        </g>
      );
    }
    case "ev":
      return (
        <g {...common}>
          <path d="M4 16v-3.5l2.2-5A2 2 0 0 1 8 6.3h8a2 2 0 0 1 1.8 1.2l2.2 5V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM4 12.5h16" />
          <circle cx="7.5" cy="17.5" r="1.6" />
          <circle cx="16.5" cy="17.5" r="1.6" />
        </g>
      );
    case "home":
      return (
        <g {...common}>
          <path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5" />
        </g>
      );
  }
}

function caption(node: FlowNode, flow: Flow): string {
  if (flow.watts === null) return "No data";
  if (node === "grid") return flow.direction === "in" ? "Importing" : flow.direction === "out" ? "Exporting" : "Balanced";
  if (node === "battery") return flow.direction === "in" ? "Discharging" : flow.direction === "out" ? "Charging" : "Idle";
  if (node === "solar") return flow.direction === "idle" ? "Not producing" : "Producing";
  if (node === "ev") return flow.direction === "idle" ? "Not charging" : "Charging";
  return "Consuming";
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
    .map((node) => `${NODES[node].label}: ${formatPower(flows[node].watts)} ${caption(node, flows[node]).toLowerCase()}`)
    .join("; ");

  return (
    <svg className="energy-flow" viewBox="0 0 640 420" role="img" aria-label={`Energy flow. ${description}`}>
      {order.map((node) => (
        <Branch key={node} node={node} flow={flows[node]} maxWatts={maxWatts} />
      ))}
      <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS} className="flow-hub" />
      {order.map((node) => (
        <NodeView key={node} node={node} flow={flows[node]} soc={summary.battery_soc_pct} />
      ))}
    </svg>
  );
}
