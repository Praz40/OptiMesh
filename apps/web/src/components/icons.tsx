import type { SVGProps } from "react";
import type { DeviceKind } from "@/lib/api";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Icon paths without the <svg> wrapper, so they can be placed inside a larger SVG. */
export function SolarGlyph() {
  return (
    <>
      <circle cx="12" cy="12" r="4.2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line key={angle} x1="12" y1="2.6" x2="12" y2="4.8" transform={`rotate(${angle} 12 12)`} />
      ))}
    </>
  );
}

export function GridGlyph() {
  return <path d="M8 22 12 3l4 19M9.2 16h5.6M10.2 11h3.6M5 7h14M7 7l5 4 5-4" />;
}

export function BatteryGlyph({ level }: { level?: number | null }) {
  const fill = Math.max(0, Math.min(1, (level ?? 0) / 100));
  return (
    <>
      <rect x="6" y="5" width="12" height="17" rx="2" />
      <path d="M10 2.5h4" />
      {level != null && (
        <rect x="8.2" y={7.2 + 12.6 * (1 - fill)} width="7.6" height={12.6 * fill} rx="0.8" fill="currentColor" stroke="none" />
      )}
    </>
  );
}

export function EvGlyph() {
  return (
    <>
      <path d="M4 16v-3.5l2.2-5A2 2 0 0 1 8 6.3h8a2 2 0 0 1 1.8 1.2l2.2 5V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM4 12.5h16" />
      <circle cx="7.5" cy="17.5" r="1.6" />
      <circle cx="16.5" cy="17.5" r="1.6" />
    </>
  );
}

export function BuildingGlyph() {
  return <path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5" />;
}

export const SolarIcon = (p: IconProps) => <Svg {...p}><SolarGlyph /></Svg>;
export const GridIcon = (p: IconProps) => <Svg {...p}><GridGlyph /></Svg>;
export const BatteryIcon = ({ level, ...p }: IconProps & { level?: number | null }) => (
  <Svg {...p}><BatteryGlyph level={level} /></Svg>
);
export const EvIcon = (p: IconProps) => <Svg {...p}><EvGlyph /></Svg>;
export const BuildingIcon = (p: IconProps) => <Svg {...p}><BuildingGlyph /></Svg>;

export const HvacIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />
  </Svg>
);
export const BoilerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c3 3.6 5.5 6.4 5.5 10a5.5 5.5 0 0 1-11 0c0-1.9.9-3.6 2.2-5 .3 1.6 1.3 2.6 2.3 3 0-3 .3-5.4 1-8Z" />
  </Svg>
);
export const PlugIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V21" />
  </Svg>
);
export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" />
  </Svg>
);
export const PortfolioIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Svg>
);
export const SiteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);
export const SimulatorIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="4" />
    <path d="M7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01" />
  </Svg>
);
export const ChartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V4M4 20h16M7.5 15l3.5-4 3 2.5 5-6" />
  </Svg>
);
export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4 2.8 19.5h18.4L12 4ZM12 10v4.2M12 17h.01" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </Svg>
);
export const LeafIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19l7-7" />
  </Svg>
);
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const CoinIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.8 9.2c-.6-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.9-2.8 2.1 0 2.9 5.8 1.4 5.8 4.3 0 1.2-1.3 2.1-3 2.1-1.3 0-2.4-.6-3-1.5M12 6v1.8M12 16.3V18" />
  </Svg>
);

/** The OptiMesh mark: a hexagonal mesh of nodes around a central hub. */
export function BrandMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M16 2.8 27.4 9.4v13.2L16 29.2 4.6 22.6V9.4Z"
        fill="currentColor"
        opacity="0.14"
      />
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M16 6.5v6.2M16 19.3v6.2M7.8 11.2l5.4 3.1M18.8 17.7l5.4 3.1M24.2 11.2l-5.4 3.1M13.2 17.7l-5.4 3.1" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      {[
        [16, 5.6],
        [26.2, 10.6],
        [26.2, 21.4],
        [16, 26.4],
        [5.8, 21.4],
        [5.8, 10.6],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" fill="currentColor" />
      ))}
    </svg>
  );
}

export const KIND_ICONS: Record<DeviceKind, (p: IconProps) => React.ReactNode> = {
  grid_meter: GridIcon,
  solar_inverter: SolarIcon,
  battery: BatteryIcon,
  ev_charger: EvIcon,
  hvac: HvacIcon,
  boiler: BoilerIcon,
  smart_plug: PlugIcon,
  load: BoltIcon,
};

export const KIND_TONES: Partial<Record<DeviceKind, string>> = {
  grid_meter: "grid",
  solar_inverter: "solar",
  battery: "battery",
  ev_charger: "ev",
};
