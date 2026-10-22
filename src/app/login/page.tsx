import { Brand } from "@/components/brand";
import { SubmitButton } from "@/components/submit-button";
import { signIn } from "@/app/auth-actions";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { ArrowUpRight, LockKeyhole } from "lucide-react";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = hasSupabaseConfig();
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand light />
        <div className="story-copy">
          <p className="eyebrow">GRANBURY, TEXAS · EST. ON HARD WORK</p>
          <h1>
            Good horses.
            <br />
            Honest work.
            <br />
            <em>All squared away.</em>
          </h1>
          <p>
            A little more time in the saddle.
            <br />A little less time at the desk.
          </p>
        </div>
        <div className="story-footer">
          <span>REINED COW HORSE & CALF ROPING</span>
          <span className="western-star">✦</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-box">
          <span className="icon-tile">
            <LockKeyhole size={22} />
          </span>
          <p className="eyebrow">THE BARN OFFICE</p>
          <h2>Welcome back.</h2>
          <p className="muted">
            Your horses and the work ahead.
            <br />
            Sign in to get the day started.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {!configured && (
            <p className="notice error">
              Add your Supabase connection settings to your local environment
              file to enable sign-in.
            </p>
          )}
          <form action={signIn} className="stack">
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@example.com"
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Your password"
              />
            </label>
            <SubmitButton>
              Sign in <ArrowUpRight size={17} />
            </SubmitButton>
          </form>
          <p className="login-note">
            Private access for Squared Away Performance Horses.
            <br />
            Accounts are created by the business owner.
          </p>
        </div>
        <p className="login-bottom">
          SQUARED AWAY PERFORMANCE HORSES <span>✦</span> GRANBURY, TX
        </p>
      </section>
    </main>
  );
}
