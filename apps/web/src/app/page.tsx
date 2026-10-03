import { Portfolio } from "@/components/portfolio";

export default function Home() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
          <p className="muted">Live energy across every site you manage.</p>
        </div>
      </div>
      <Portfolio />
    </>
  );
}
