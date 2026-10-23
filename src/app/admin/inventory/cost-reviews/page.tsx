import { SectionTabs } from "@/components/section-tabs";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { money, dateLabel } from "@/lib/format";
import { PageHeading, Notice } from "@/components/ui";
type Correction = {
  id: string;
  movement_id: string;
  old_cost_cents: number;
  new_cost_cents: number;
  reason: string;
  created_at: string;
  inventory_movements: {
    movement_date: string;
    inventory_products: { name: string };
  };
  inventory_cost_changes: {
    movement_id: string;
    old_cost: number | string;
    new_cost: number | string;
    inventory_movements: {
      kind: string;
      movement_date: string;
      horses: { barn_name: string } | null;
    };
  }[];
};
type Flag = {
  correction_id: string;
  invoice_id: string;
  resolved_at: string | null;
  resolution: string | null;
  invoices: {
    invoice_number: number | null;
    status: string;
    customers: { name: string };
  };
};
export default async function CostReviews({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { db } = await requireAdmin();
  const query = await searchParams;
  const [corrections, flags, reviews] = await Promise.all([
    db
      .from("inventory_cost_corrections")
      .select(
        "id,movement_id,old_cost_cents,new_cost_cents,reason,created_at,inventory_movements(movement_date,inventory_products(name)),inventory_cost_changes(movement_id,old_cost,new_cost,inventory_movements(kind,movement_date,horses(barn_name)))",
      )
      .order("created_at", { ascending: false })
      .limit(50)
      .limit(100, { referencedTable: "inventory_cost_changes" })
      .returns<Correction[]>(),
    db
      .from("invoice_feed_cost_flags")
      .select(
        "correction_id,invoice_id,resolved_at,resolution,invoices(invoice_number,status,customers(name))",
      )
      .is("resolved_at", null)
      .limit(100)
      .returns<Flag[]>(),
    db
      .from("invoice_feed_cost_flags")
      .select(
        "correction_id,invoice_id,resolved_at,resolution,invoices(invoice_number,status,customers(name))",
      )
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(50)
      .returns<Flag[]>(),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="FEED INVENTORY"
        title="Cost corrections & reviews"
        description="Recalculated stock history and invoices needing a decision."
      />
      <Notice
        success={query.success}
        error={
          corrections.error || flags.error || reviews.error
            ? "Cost review history could not load. Refresh before making changes."
            : undefined
        }
      />
      <div className="row-actions">
        <Link className="text-link" href="/admin/inventory#inventory-ledger">
          Stock history
        </Link>
      </div>
      <SectionTabs
        id="cost-reviews"
        label="Cost correction sections"
        sections={[
          {
            id: "pending",
            label: "Needs review",
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Invoices needing review</h2>
                </div>
                <div className="record-form">
                  <p>
                    Up to 100 pending correction reviews. Invoice charges remain
                    unchanged; open each invoice to review its feed charges and
                    record your decision.
                  </p>
                  {!flags.error && !flags.data?.length && (
                    <p>No pending reviews.</p>
                  )}
                  {flags.data?.map((f) => (
                    <p key={`${f.correction_id}-${f.invoice_id}`}>
                      <Link
                        className="text-link"
                        href={`/admin/invoices/${f.invoice_id}`}
                      >
                        Review{" "}
                        {f.invoices?.invoice_number
                          ? `invoice #${f.invoices.invoice_number}`
                          : "draft invoice"}{" "}
                        · {f.invoices?.customers?.name ?? "Customer"}
                      </Link>
                    </p>
                  ))}
                </div>
              </section>
            ),
          },
          {
            id: "corrections",
            label: "Cost history",
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Latest 50 cost corrections</h2>
                </div>
                <div className="record-form">
                  {!corrections.error && !corrections.data?.length && (
                    <p>No stock cost recalculations recorded.</p>
                  )}
                  {corrections.data?.map((c) => (
                    <article className="log-entry" key={c.id}>
                      <h3>
                        {c.inventory_movements?.inventory_products?.name ??
                          "Stock entry"}{" "}
                        · {money(c.old_cost_cents)} → {money(c.new_cost_cents)}
                      </h3>
                      <p>
                        {dateLabel(c.created_at.slice(0, 10))} · {c.reason}
                      </p>
                      <p className="muted">
                        Stock entry date:{" "}
                        {dateLabel(c.inventory_movements?.movement_date ?? "")}
                      </p>
                      <details>
                        <summary>
                          Changed stock costs (up to 100 entries)
                        </summary>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Stock entry</th>
                                <th>Before</th>
                                <th>After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.inventory_cost_changes.map((m) => (
                                <tr key={m.movement_id}>
                                  <td>
                                    {m.inventory_movements?.kind.replaceAll(
                                      "_",
                                      " ",
                                    )}{" "}
                                    ·{" "}
                                    {dateLabel(
                                      m.inventory_movements?.movement_date ??
                                        "",
                                    )}{" "}
                                    {m.inventory_movements?.horses?.barn_name}
                                  </td>
                                  <td>{money(Number(m.old_cost))}</td>
                                  <td>{money(Number(m.new_cost))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            ),
          },
          {
            id: "completed",
            label: "Completed reviews",
            content: (
              <section className="panel">
                <div className="record-form">
                  <details>
                    <summary>Completed invoice reviews (latest 50)</summary>
                    {reviews.data?.map((r) => (
                      <article
                        className="log-entry"
                        key={`${r.correction_id}-${r.invoice_id}`}
                      >
                        <p>
                          <Link
                            className="text-link"
                            href={`/admin/invoices/${r.invoice_id}`}
                          >
                            {r.invoices?.customers?.name ?? "Customer"} ·{" "}
                            {r.invoices?.invoice_number
                              ? `Invoice #${r.invoices.invoice_number}`
                              : "Draft invoice"}
                          </Link>
                        </p>
                        <p>
                          {r.resolved_at
                            ? dateLabel(r.resolved_at.slice(0, 10))
                            : ""}{" "}
                          · {r.resolution}
                        </p>
                      </article>
                    ))}
                  </details>
                </div>
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
