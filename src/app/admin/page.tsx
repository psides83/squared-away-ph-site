import Link from "next/link";
import {
  FinancialOverview,
  type FinancialOverviewData,
} from "@/components/financial-overview";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, today } from "@/lib/format";
import { PageHeading, EmptyState } from "@/components/ui";
import {
  ArrowRight,
  ArrowUpRight,
  Fence,
  UsersRound,
  CalendarDays,
  ClipboardList,
  Plus,
  Sun,
  BookOpen,
} from "lucide-react";

export default async function Dashboard() {
  const { db } = await requireAdmin();
  const [horses, customers, stays, reminders, finance] = await Promise.all([
    db
      .from("horses")
      .select("id, barn_name, breed", { count: "exact" })
      .order("barn_name")
      .limit(5),
    db.from("customers").select("id", { count: "exact", head: true }),
    db
      .from("training_stays")
      .select("id", { count: "exact", head: true })
      .lte("arrival_date", today())
      .or(`departure_date.is.null,departure_date.gte.${today()}`),
    db
      .from("reminders")
      .select("id, title, due_date")
      .is("completed_at", null)
      .order("due_date")
      .limit(5),
    db.rpc("admin_financial_overview"),
  ]);
  const failed = [horses, customers, stays, reminders].some(
    (result) => result.error,
  );
  const stats = [
    {
      label: "HORSES IN TRAINING",
      value: stays.count ?? 0,
      caption: "Current training stays",
      icon: Fence,
      href: "/admin/training",
    },
    {
      label: "HORSES ON FILE",
      value: horses.count ?? 0,
      caption: "Every horse, one place",
      icon: ClipboardList,
      href: "/admin/horses",
    },
    {
      label: "CUSTOMERS",
      value: customers.count ?? 0,
      caption: "People behind the horses",
      icon: UsersRound,
      href: "/admin/customers",
    },
    {
      label: "UP NEXT",
      value: reminders.data?.length
        ? `${reminders.data.length}${reminders.data.length === 5 ? "+" : ""}`
        : 0,
      caption: "Upcoming & overdue reminders",
      icon: CalendarDays,
      href: "/admin/reminders",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow={dateLabel(today()).toUpperCase()}
        title="A good day starts here."
        description="A clear view of the horses, the people, and the work ahead."
        action={{ href: "/admin/horses?new=1", label: "Add a horse" }}
      />
      {failed ? (
        <p className="notice error" role="alert">
          We couldn’t load your barn records. Check that the database migration
          has been applied, then refresh.
        </p>
      ) : (
        <>
          <section className="welcome-strip">
            <span className="welcome-icon">
              <Sun size={30} strokeWidth={1.3} />
            </span>
            <div>
              <p className="eyebrow">WELCOME TO YOUR BARN OFFICE</p>
              <p>Good records leave more room for good work.</p>
            </div>
            <span className="welcome-star" aria-hidden="true">
              ✦
            </span>
          </section>
          <div className="stats-grid">
            {stats.map(({ label, value, caption, icon: Icon, href }) => (
              <Link href={href} className="stat-card" key={label}>
                <div className="stat-top">
                  <span>{label}</span>
                  <Icon size={19} strokeWidth={1.5} />
                </div>
                <strong>{value}</strong>
                <div className="stat-bottom">
                  <span>{caption}</span>
                  <ArrowUpRight size={16} />
                </div>
              </Link>
            ))}
          </div>
          {finance.error || !finance.data ? (
            <p className="notice error" role="alert">
              Financial totals couldn’t load. Check the latest database
              migration and refresh. Your barn records are still available
              below.
            </p>
          ) : (
            <FinancialOverview data={finance.data as FinancialOverviewData} />
          )}
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">THE HORSE COMES FIRST</p>
                  <h2>Around the barn</h2>
                </div>
                <Link href="/admin/horses" className="text-link">
                  All horses <ArrowRight size={15} />
                </Link>
              </div>
              {horses.data?.length ? (
                <div className="record-list">
                  {horses.data.map((horse) => (
                    <Link
                      className="record-row"
                      href={`/admin/horses?edit=${horse.id}`}
                      key={horse.id}
                    >
                      <span className="horse-initial">
                        {horse.barn_name.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{horse.barn_name}</strong>
                        <small>{horse.breed || "Horse profile"}</small>
                      </div>
                      <ArrowUpRight size={17} />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Fence}
                  title="Your next chapter starts with a horse."
                  description="Add your first horse to keep their profile, training, and care all together."
                  href="/admin/horses?new=1"
                  label="Add your first horse"
                />
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">DON’T MISS A BEAT</p>
                  <h2>On the calendar</h2>
                </div>
                <CalendarDays size={21} strokeWidth={1.4} />
              </div>
              {reminders.data?.length ? (
                <div className="record-list">
                  {reminders.data.map((reminder) => (
                    <Link
                      key={reminder.id}
                      className="reminder-row"
                      href={`/admin/reminders?edit=${reminder.id}`}
                    >
                      <span
                        className={
                          reminder.due_date < today()
                            ? "reminder-date overdue"
                            : "reminder-date"
                        }
                      >
                        {dateLabel(reminder.due_date)}
                      </span>
                      <strong>{reminder.title}</strong>
                      <ArrowUpRight size={16} />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={CalendarDays}
                  title="A little planning goes a long way."
                  description="Keep farrier visits, vaccinations, and the everyday details on your radar."
                  href="/admin/reminders?new=1"
                  label="Create a reminder"
                />
              )}
            </section>
          </div>
          <section className="quick-section">
            <p className="eyebrow">KEEP THINGS MOVING</p>
            <div className="quick-grid">
              {[
                {
                  href: "/admin/customers?new=1",
                  label: "Add a customer",
                  sub: "Start with the people",
                  icon: UsersRound,
                },
                {
                  href: "/admin/log?new=1",
                  label: "Log a session / note",
                  sub: "Capture the work while it’s fresh",
                  icon: BookOpen,
                },
                {
                  href: "/admin/reminders?new=1",
                  label: "Set a reminder",
                  sub: "Take it off your mental list",
                  icon: CalendarDays,
                },
              ].map(({ href, label, sub, icon: Icon }) => (
                <Link className="quick-card" key={href} href={href}>
                  <Icon size={22} strokeWidth={1.4} />
                  <div>
                    <strong>{label}</strong>
                    <small>{sub}</small>
                  </div>
                  <Plus size={17} />
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
