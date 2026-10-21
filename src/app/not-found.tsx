import Link from "next/link";
export default function NotFound() {
  return (
    <main className="access-page">
      <div className="panel access-card">
        <p className="eyebrow">OFF THE TRAIL</p>
        <h1>This page isn’t here.</h1>
        <p className="muted">Head back to your office to find what you need.</p>
        <Link className="button" href="/admin">
          Back to the office
        </Link>
      </div>
    </main>
  );
}
