import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeading } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { TemporalInput } from "@/components/temporal-input";
import { FeedAbsorptionReport } from "@/components/feed-absorption-report";
import type { AbsorptionReport } from "@/lib/feed-absorption";
import { today } from "@/lib/format";
import { validCashExportPeriod } from "@/lib/cash-export";
export default async function Absorption({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    horse?: string;
    page?: string;
  }>;
}) {
  const q = await searchParams,
    { db } = await requireAdmin(),
    date = today();
  const from = q.from ?? `${date.slice(0, 7)}-01`,
    to = q.to ?? date;
  const horse =
    typeof q.horse === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      q.horse,
    )
      ? q.horse
      : "";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const valid = validCashExportPeriod(from, to);
  const [r, h] = await Promise.all([
    valid
      ? db.rpc("feed_absorption_report", {
          p_from: from,
          p_to: to,
          p_horse: horse || null,
          p_page: page,
        })
      : Promise.resolve({ data: null, error: null }),
    db
      .from("horses")
      .select("id,barn_name", { count: "exact" })
      .order("barn_name")
      .limit(1000),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="BILLING DECISIONS"
        title="Absorbed feed costs"
        description="Choose feed costs the business will absorb while keeping full consumption costs in profit reports."
      />
      <div className="row-actions">
        <Link
          className="button secondary"
          href="/admin/feeding#feeding-history"
        >
          Back to feeding history
        </Link>
      </div>
      <section className="panel">
        <form method="get" className="record-form">
          <div className="form-grid">
            <label>
              From
              <TemporalInput
                name="from"
                type="date"
                required
                defaultValue={from}
              />
            </label>
            <label>
              Through
              <TemporalInput name="to" type="date" required defaultValue={to} />
            </label>
            <label>
              Horse
              <AppSelect name="horse" defaultValue={horse}>
                <option value="">All horses</option>
                {h.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.barn_name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <div className="form-actions">
              <button type="submit" className="button primary">
                Update records
              </button>
            </div>
          </div>
          {(h.count ?? 0) > 1000 && (
            <p className="notice">
              Horse options are limited to the first 1,000 records.
            </p>
          )}
        </form>
      </section>
      {!valid ? (
        <p className="notice error">
          Choose valid dates covering at most ten years.
        </p>
      ) : (
        <FeedAbsorptionReport
          data={r.error ? null : (r.data as AbsorptionReport | null)}
          from={from}
          to={to}
          horse={horse}
          page={page}
        />
      )}
    </>
  );
}
