import { Portfolio } from "@/components/portfolio";

export default function Home() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Портфолио</h1>
          <p className="muted">Енергията на живо във всички ваши обекти.</p>
        </div>
      </div>
      <Portfolio />
    </>
  );
}
