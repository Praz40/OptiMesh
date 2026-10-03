import { Portfolio } from "@/components/portfolio";

export default function Home() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Your sites</h1>
          <p className="muted">Live energy across every location you manage.</p>
        </div>
      </div>
      <Portfolio />
    </>
  );
}
