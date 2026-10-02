import Link from "next/link";
import { ConnectionStatus } from "@/components/connection-status";

export default function Home() {
  return (
    <main>
      <header><Link className="wordmark" href="/">Opti<span>Mesh</span></Link><span>Project starter</span></header>
      <section className="intro">
        <h1>A shared foundation for smarter energy.</h1>
        <p>Connect your devices, simulator and dashboard through one stable contract.</p>
      </section>
      <ConnectionStatus />
      <section className="foundation" aria-labelledby="foundation-title">
        <h2 id="foundation-title">Build the first live loop</h2>
        <ol>
          <li><span>01</span><div><h3>Connect a device</h3><p>Hardware and simulation publish the same telemetry.</p></div></li>
          <li><span>02</span><div><h3>Show the energy flow</h3><p>Persist measurements and stream the latest values to the dashboard.</p></div></li>
          <li><span>03</span><div><h3>Close the loop</h3><p>Validate a command, send it to the device and confirm its result.</p></div></li>
        </ol>
      </section>
      <footer><span>Next.js · FastAPI · PostgreSQL</span><a href="https://github.com/Praz40/OptiMesh/issues">Project backlog</a></footer>
    </main>
  );
}
