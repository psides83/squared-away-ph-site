"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel access-card">
      <p className="eyebrow">LET’S TRY THAT AGAIN</p>
      <h1>The barn office couldn’t load.</h1>
      <p className="muted">
        Check your connection and Supabase setup, then try again. Your saved
        records haven’t been changed.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
