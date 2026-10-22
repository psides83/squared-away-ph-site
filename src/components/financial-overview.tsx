import Link from "next/link";
import {
  ArrowUpRight,
  Receipt,
  FileText,
  BookOpen,
  ArrowRight,
} from "lucide-react";
import { money, dateLabel } from "@/lib/format";
export type FinancialOverviewData = {
  as_of: string;
  month_from: string;
  received_cents: number;
  spent_cents: number;
  net_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  outstanding_count: number;
  overdue_count: number;
  recent: {
    id: string;
    kind: string;
    event_at: string;
    label: string;
    detail: string;
    href: string;
  }[];
};
export function FinancialOverview({ data }: { data: FinancialOverviewData }) {
  return (
    <>
      <section className="quick-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">THE BUSINESS AT A GLANCE</p>
            <h2>Cash & billing</h2>
          </div>
          <Link className="text-link" href="/admin/reports">
            Full reports <ArrowRight size={15} />
          </Link>
        </div>
        <div className="stats-grid">
          {[
            {
              label: "OUTSTANDING NOW",
              value: data.outstanding_cents,
              caption: `${data.outstanding_count} issued invoices with a balance`,
              href: "/admin/invoices",
            },
            {
              label: "OVERDUE NOW",
              value: data.overdue_cents,
              caption: `${data.overdue_count} invoices past their due date`,
              href: "/admin/invoices",
            },
            {
              label: "RECEIVED THIS MONTH",
              value: data.received_cents,
              caption: `${dateLabel(data.month_from)} – ${dateLabel(data.as_of)}`,
              href: `/admin/reports?from=${data.month_from}&to=${data.as_of}`,
            },
            {
              label: "NET CASH THIS MONTH",
              value: data.net_cents,
              caption: `After ${money(data.spent_cents)} in expenses paid`,
              href: `/admin/reports?from=${data.month_from}&to=${data.as_of}`,
            },
          ].map((c) => (
            <Link key={c.label} className="stat-card" href={c.href}>
              <div className="stat-top">
                <span>{c.label}</span>
                <Receipt size={19} strokeWidth={1.5} />
              </div>
              <strong>{money(c.value)}</strong>
              <div className="stat-bottom">
                <span>{c.caption}</span>
                <ArrowUpRight size={16} />
              </div>
            </Link>
          ))}
        </div>
        <p className="muted">
          Cash totals use recorded payment dates, excluding reversals and voided
          expenses. Outstanding balances cover all dates and are separate from
          cash received.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RECENT RECORDS</p>
            <h2>Latest around the office</h2>
          </div>
        </div>
        {data.recent.length ? (
          <div className="record-list">
            {data.recent.map((r) => (
              <Link
                className="record-row"
                key={`${r.kind}:${r.id}`}
                href={r.href}
              >
                {r.kind === "training" ? (
                  <BookOpen size={20} />
                ) : r.kind === "invoice" ? (
                  <FileText size={20} />
                ) : (
                  <Receipt size={20} />
                )}
                <div>
                  <strong>{r.label}</strong>
                  <small>
                    {r.detail} ·{" "}
                    {new Date(r.event_at).toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    Central
                  </small>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="record-form muted">
            Invoices, payments, expenses, and training records will appear here
            as you add them.
          </p>
        )}
      </section>
    </>
  );
}
