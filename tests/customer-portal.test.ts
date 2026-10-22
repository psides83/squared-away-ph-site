import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
const id = (n: number) =>
  `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ca = id(1),
  cb = id(2),
  ha = id(3),
  hiddenHorse = id(4),
  ua = id(5),
  ub = id(6),
  replacement = id(7),
  invoiceA = id(8),
  invoiceB = id(9),
  draft = id(10);
test("customer portal shares only explicitly published and granted horse updates, with separate billing", async (t) => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into auth.users(id,email) values('${ua}','first@example.com'),('${ub}','second@example.com'),('${replacement}','replacement@example.com');
      insert into public.customers(id,name,email,notes) values('${ca}','First customer','first@example.com','PRIVATE CUSTOMER NOTES'),('${cb}','Co-owner','second@example.com','OTHER CUSTOMER NOTES');
      insert into public.horses(id,barn_name,registered_name,health_notes,feeding_instructions,training_goals) values('${ha}','Shared horse','Registered horse','PRIVATE HEALTH','PRIVATE FEED','PRIVATE GOALS'),('${hiddenHorse}','Hidden horse',null,'OTHER HEALTH',null,null);
      insert into public.horse_customers(horse_id,customer_id) values('${ha}','${ca}'),('${ha}','${cb}');
      insert into public.training_entries(horse_id,kind,entry_date,title,notes) values('${ha}','note','2026-01-01','PRIVATE TRAINING TITLE','PRIVATE TRAINING NOTES');
      insert into public.invoices(id,customer_id,status,issue_date,due_date,issued_total_cents,customer_snapshot,business_snapshot,notes) values
        ('${invoiceA}','${ca}','issued','2026-01-01','2026-01-05',10000,'{"name":"First customer"}','{"name":"Squared Away","payment_instructions":"Pay your invoice"}','Customer-facing note'),
        ('${invoiceB}','${cb}','issued','2026-01-01','2026-01-05',20000,'{"name":"Co-owner"}',null,'OTHER CUSTOMER BILL'),
        ('${draft}','${ca}','draft','2026-01-01','2026-01-05',90000,null,null,'PRIVATE DRAFT');
      insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values('${invoiceA}','Training',10000,'manual','{"private_cost":"INTERNAL SOURCE"}');
      insert into public.invoice_payments(id,invoice_id,paid_on,amount_cents,method,notes,reference) values(gen_random_uuid(),'${invoiceA}','2026-01-04',2500,'cash','PRIVATE PAYMENT NOTE','PRIVATE REFERENCE');
      update public.business_settings set business_phone='555-0100',business_email='barn@example.com',payment_instructions='PRIVATE DEFAULT PAYMENT SETTING';
    `);
    await login(db, adminId);
    const grant = async (request: string, customer: string, email: string) =>
      db.query(
        "select public.grant_customer_portal($1,$2,$3,'Approved customer sign-in')",
        [request, customer, email],
      );
    const access = async (
      customer: string,
      horse: string,
      active = true,
      from: string | null = null,
      request = crypto.randomUUID(),
    ) =>
      db.query(
        "select public.set_customer_horse_access($1,$2,$3,$4,$5,'Manual horse access review')",
        [request, customer, horse, from, active],
      );
    const save = async (
      request: string,
      update: string | null,
      horse: string,
      title: string,
      body: string,
    ) =>
      (
        await db.query<{ id: string }>(
          "select public.save_horse_update($1,$2,$3,'2026-01-01',$4,$5) id",
          [request, update, horse, title, body],
        )
      ).rows[0].id;
    const publish = async (update: string, action = "publish") =>
      db.query(
        "select public.change_horse_update($1,$2,'Reviewed customer-visible copy')",
        [update, action],
      );
    const horses = async () =>
      (await db.query<{ r: any }>("select public.portal_horses() r")).rows[0].r;
    const updates = async (horse: string | null = null) =>
      (
        await db.query<{ r: any }>("select public.portal_updates($1,1) r", [
          horse,
        ])
      ).rows[0].r;
    const invoices = async () =>
      (await db.query<{ r: any }>("select public.portal_invoices(1) r")).rows[0]
        .r;
    const invoice = async (invoice: string) =>
      (
        await db.query<{ r: any }>("select public.portal_invoice($1) r", [
          invoice,
        ])
      ).rows[0].r;
    let visible = "",
      hidden = "",
      unsaved = "";
    await t.test(
      "accounts require explicit admin linking, and ownership alone grants no horse access",
      async () => {
        await grant(id(20), ca, " FIRST@example.com ");
        await grant(id(20), ca, "first@example.com");
        await grant(id(21), cb, "second@example.com");
        await assert.rejects(
          grant(id(20), ca, "replacement@example.com"),
          /already used/,
        );
        await assert.rejects(
          grant(id(22), cb, "first@example.com"),
          /already linked/,
        );
        await assert.rejects(
          grant(id(23), ca, "unknown@example.com"),
          /Create this customer sign-in/,
        );
        await login(db, ua);
        assert.deepEqual(await horses(), []);
        assert.equal((await invoices()).rows.length, 1);
        const profile = (
          await db.query<{ r: any }>("select public.portal_profile() r")
        ).rows[0].r;
        assert.equal(profile.name, "First customer");
        assert.equal(profile.contact.phone, "555-0100");
        assert.ok(!JSON.stringify(profile).includes("PRIVATE"));
        await login(db, adminId);
      },
    );
    await t.test(
      "publishing is explicit; drafts/private notes never become customer updates",
      async () => {
        visible = await save(
          id(30),
          null,
          ha,
          "Shared progress",
          "CUSTOMER VISIBLE BODY",
        );
        assert.equal(
          await save(
            id(30),
            null,
            ha,
            "Shared progress",
            "CUSTOMER VISIBLE BODY",
          ),
          visible,
        );
        hidden = await save(
          id(31),
          null,
          hiddenHorse,
          "Other horse update",
          "HIDDEN HORSE BODY",
        );
        await publish(hidden);
        unsaved = await save(
          id(32),
          null,
          ha,
          "Unpublished draft",
          "PRIVATE UPDATE DRAFT",
        );
        await access(ca, ha);
        await access(cb, ha);
        await login(db, ua);
        assert.equal((await updates()).total, 0);
        await login(db, adminId);
        await publish(visible);
        await publish(visible);
        await assert.rejects(
          save(id(33), visible, ha, "Silently changed", "Not permitted"),
          /Unpublish first/,
        );
        await login(db, ua);
        const h = await horses();
        assert.equal(h.length, 1);
        assert.equal(h[0].registered_name, "Registered horse");
        assert.ok(!JSON.stringify(h).includes("PRIVATE"));
        const u = await updates();
        assert.equal(u.total, 1);
        assert.equal(u.rows[0].body, "CUSTOMER VISIBLE BODY");
        assert.equal((await updates(hiddenHorse)).total, 0);
        assert.ok(!JSON.stringify(u).includes("PRIVATE"));
        await login(db, ub);
        assert.equal((await updates()).total, 1);
        await login(db, adminId);
      },
    );
    await t.test(
      "co-owners see only their own issued billing, and internal source/payment details remain private",
      async () => {
        await login(db, ua);
        const list = await invoices();
        assert.equal(list.total, 1);
        assert.equal(Number(list.outstanding_cents), 7500);
        const own = await invoice(invoiceA);
        assert.equal(own.notes, "Customer-facing note");
        assert.equal(own.payments.length, 1);
        assert.ok(!JSON.stringify(own).includes("PRIVATE"));
        assert.ok(!JSON.stringify(own).includes("INTERNAL SOURCE"));
        assert.equal(await invoice(invoiceB), null);
        assert.equal(await invoice(draft), null);
        await login(db, ub);
        assert.equal((await invoices()).rows[0].id, invoiceB);
        assert.equal(await invoice(invoiceA), null);
        await login(db, adminId);
      },
    );
    await t.test(
      "publication-date bounds and manual revocation apply independently from billing or ownership",
      async () => {
        const tomorrow = (
          await db.query<{ d: string }>(
            "select to_char((now() at time zone 'America/Chicago')::date+1,'YYYY-MM-DD') d",
          )
        ).rows[0].d;
        await access(ca, ha, true, tomorrow);
        await login(db, ua);
        assert.equal((await updates()).total, 0);
        assert.equal((await invoices()).total, 1);
        await login(db, adminId);
        await access(ca, ha, true, null);
        await db.exec("reset role");
        await db.query(
          "delete from public.horse_customers where horse_id=$1 and customer_id=$2",
          [ha, ca],
        );
        await login(db, ua);
        assert.equal((await updates()).total, 1);
        await login(db, adminId);
        await access(ca, ha, false);
        await login(db, ua);
        assert.equal((await updates()).total, 0);
        assert.equal((await horses()).length, 0);
        assert.equal((await invoices()).total, 1);
        await login(db, adminId);
        await access(ca, ha, true);
      },
    );
    await t.test(
      "unpublishing and archiving immediately hide text and preserve publication history",
      async () => {
        await publish(visible, "unpublish");
        await login(db, ub);
        assert.equal((await updates()).total, 0);
        await login(db, adminId);
        await save(
          id(40),
          visible,
          ha,
          "Revised progress",
          "REVISED CUSTOMER COPY",
        );
        await publish(visible);
        await login(db, ub);
        assert.equal((await updates()).rows[0].body, "REVISED CUSTOMER COPY");
        await login(db, adminId);
        await publish(visible, "archive");
        await assert.rejects(publish(visible), /Archived/);
        await login(db, ua);
        assert.equal((await updates()).total, 0);
        await login(db, adminId);
        assert.ok(
          (
            await db.query(
              "select * from public.portal_admin_events where update_id=$1",
              [visible],
            )
          ).rows.length >= 5,
        );
        assert.equal(
          (
            await db.query("select * from public.horse_updates where id=$1", [
              visible,
            ])
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "disabling or replacing a linked login removes its old session access immediately",
      async () => {
        await db.query(
          "select public.disable_customer_portal($1,'Account disabled')",
          [ca],
        );
        await login(db, ua);
        await assert.rejects(horses(), /Customer portal access/);
        await assert.rejects(invoices(), /Customer portal access/);
        await assert.rejects(invoice(invoiceA), /Customer portal access/);
        await login(db, adminId);
        await grant(id(50), ca, "first@example.com");
        await login(db, ua);
        assert.equal((await invoices()).total, 1);
        await login(db, adminId);
        await grant(id(51), ca, "replacement@example.com");
        await login(db, ua);
        await assert.rejects(invoices(), /Customer portal access/);
        await login(db, replacement);
        assert.equal((await invoices()).total, 1);
        await login(db, adminId);
      },
    );
    await t.test(
      "customers cannot query admin data, change grants, publish updates, or use financial/stock functions",
      async () => {
        await login(db, ub);
        for (const table of [
          "customers",
          "horses",
          "horse_customers",
          "training_stays",
          "training_entries",
          "reminders",
          "expenses",
          "inventory_movements",
          "business_settings",
          "invoices",
          "invoice_lines",
          "invoice_payments",
          "customer_portal_accounts",
          "customer_horse_access",
          "horse_updates",
          "portal_admin_events",
        ])
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            0,
            table,
          );
        await assert.rejects(
          db.exec("update public.customer_horse_access set active=true"),
          /permission denied/,
        );
        await assert.rejects(
          grant(id(60), ca, "second@example.com"),
          /Administrator access/,
        );
        await assert.rejects(access(cb, hiddenHorse), /Administrator access/);
        await assert.rejects(
          save(id(61), null, ha, "Forged", "Forged"),
          /Administrator access/,
        );
        await assert.rejects(publish(unsaved), /Administrator access/);
        await assert.rejects(
          db.exec(
            "select public.financial_report_bundle('2026-01-01','2026-01-31')",
          ),
          /Administrator access/,
        );
        await login(db, outsiderId);
        await assert.rejects(horses(), /Customer portal access/);
        await assert.rejects(invoices(), /Customer portal access/);
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.exec("select public.portal_horses()"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
