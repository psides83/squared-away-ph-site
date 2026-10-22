import { AppSelect } from "@/components/app-select";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel } from "@/lib/format";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
import { portalAccessAction } from "./actions";
export default async function CustomerAccess({
  searchParams,
}: {
  searchParams: Promise<{
    customer?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const query = await searchParams;
  const { db } = await requireAdmin();
  const id =
    query.customer && /^[0-9a-f-]{36}$/i.test(query.customer)
      ? query.customer
      : null;
  const [customers, horses, accounts, access, history] = await Promise.all([
    db.from("customers").select("id,name,email").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
    db.from("customer_portal_accounts").select("*"),
    db.from("customer_horse_access").select("*"),
    id
      ? db
          .from("portal_admin_events")
          .select("id,kind,reason,created_at")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const customer = customers.data?.find((c) => c.id === id);
  const account = accounts.data?.find((a) => a.customer_id === id);
  const grants = access.data?.filter((a) => a.customer_id === id) ?? [];
  const failed = [customers, horses, accounts, access, history].some(
    (r) => r.error,
  );
  return (
    <>
      <PageHeading
        eyebrow="SHARED WITH CARE"
        title="Customer portal access"
        description="Link sign-in accounts and explicitly choose each customer’s horse access."
      />
      <Notice
        error={
          failed
            ? "Portal access could not load. Check the latest migration."
            : query.error
        }
        success={query.success}
      />
      <p className="notice">
        Create the customer’s sign-in account in Supabase Authentication first,
        then link its exact email here. This screen does not send email
        invitations. A customer sees only their own billing. Horse updates
        require a separate manual grant; ownership changes do not grant or
        revoke it. Review these grants whenever a horse is sold.
      </p>
      <section className="panel">
        <form method="get" className="record-form">
          <label>
            Customer
            <AppSelect name="customer" defaultValue={id ?? ""} required>
              <option value="" disabled>
                Select a customer
              </option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </AppSelect>
          </label>
          <button className="button secondary" type="submit">
            Manage access
          </button>
        </form>
      </section>
      {!failed && customer && (
        <>
          <ActionPanel id="sign-in-access" label="Manage sign-in access">
            <div className="panel-heading">
              <h2>{customer.name} · sign-in access</h2>
              <span className="tag">
                {account?.active
                  ? "Active"
                  : account
                    ? "Disabled"
                    : "Not linked"}
              </span>
            </div>
            {account && (
              <p className="record-form">
                Linked sign-in email: {account.linked_email}. Linking another
                account replaces the previous login’s access to this customer’s
                records.
              </p>
            )}
            <form
              action={portalAccessAction.bind(null, "account")}
              className="record-form"
            >
              <input
                name="request_id"
                type="hidden"
                value={crypto.randomUUID()}
              />
              <input name="customer_id" type="hidden" value={customer.id} />
              <Field
                label="Existing sign-in email"
                name="email"
                type="email"
                required
                maxLength={254}
                defaultValue={account?.linked_email ?? customer.email}
              />
              <Field
                name="reason"
                label="Reason for linking / enabling"
                required
                maxLength={2000}
              />
              <SubmitButton>Link and enable customer account</SubmitButton>
            </form>
            {account?.active && (
              <form
                action={portalAccessAction.bind(null, "disable")}
                className="record-form separated"
              >
                <input name="customer_id" type="hidden" value={customer.id} />
                <Field
                  label="Reason for disabling"
                  name="reason"
                  required
                  maxLength={2000}
                />
                <DeleteButton
                  label="Disable all portal access"
                  confirmText="Disable this customer login? Horse updates and billing will become inaccessible until you enable it again. Records will remain."
                />
              </form>
            )}
          </ActionPanel>
          <ActionPanel id="horse-access" label="Manage shared horse access">
            <div className="panel-heading">
              <h2>Horse updates shared with {customer.name}</h2>
              <Link className="text-link" href="/admin/updates">
                Manage published updates
              </Link>
            </div>
            <p className="record-form">
              Published updates are shared among customers you explicitly grant
              access to. A blank starting date allows all published history; the
              default for a new grant is today. The filter uses the date the
              update is published, not its training date.
            </p>
            <form
              action={portalAccessAction.bind(null, "horse")}
              className="record-form"
            >
              <input
                name="request_id"
                type="hidden"
                value={crypto.randomUUID()}
              />
              <input name="customer_id" type="hidden" value={customer.id} />
              <input name="active" type="hidden" value="yes" />
              <div className="form-grid">
                <label>
                  Horse
                  <AppSelect name="horse_id" required defaultValue="">
                    <option value="" disabled>
                      Select a horse
                    </option>
                    {horses.data?.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.barn_name}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <Field
                  name="visible_from"
                  label="Updates published from (blank = all history)"
                  type="date"
                  defaultValue={today()}
                />
              </div>
              <Field
                name="reason"
                label="Access reason"
                required
                maxLength={2000}
              />
              <SubmitButton>Grant / update horse access</SubmitButton>
            </form>
            {grants.map((g) => (
              <div className="record-form separated" key={g.horse_id}>
                <h3>
                  {horses.data?.find((h) => h.id === g.horse_id)?.barn_name} ·{" "}
                  {g.active ? "Shared" : "Revoked"}
                </h3>
                <p>
                  {g.visible_from
                    ? `Updates published from ${dateLabel(g.visible_from)}`
                    : "All published history"}
                </p>
                {g.active && (
                  <form action={portalAccessAction.bind(null, "horse")}>
                    <input
                      name="request_id"
                      type="hidden"
                      value={crypto.randomUUID()}
                    />
                    <input
                      name="customer_id"
                      type="hidden"
                      value={customer.id}
                    />
                    <input name="horse_id" type="hidden" value={g.horse_id} />
                    <input
                      name="visible_from"
                      type="hidden"
                      value={g.visible_from ?? ""}
                    />
                    <input name="active" type="hidden" value="no" />
                    <Field
                      label="Reason for revoking horse access"
                      name="reason"
                      required
                      maxLength={2000}
                    />
                    <DeleteButton
                      label="Revoke horse access"
                      confirmText="Revoke this customer's access to this horse's published updates? Their own billing history will remain available."
                    />
                  </form>
                )}
              </div>
            ))}
          </ActionPanel>
          <section className="panel">
            <div className="panel-heading">
              <h2>Access history (latest 20)</h2>
            </div>
            {history.data?.map((e) => (
              <p className="record-form" key={e.id}>
                <strong>{e.kind.replaceAll("_", " ")}</strong> · {e.reason}
                <small className="cell-secondary">
                  {new Date(e.created_at).toLocaleString("en-US", {
                    timeZone: "America/Chicago",
                  })}{" "}
                  Central
                </small>
              </p>
            ))}
          </section>
        </>
      )}
    </>
  );
}
