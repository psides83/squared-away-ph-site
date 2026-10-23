import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import { ActionPanel } from "@/components/action-panel";
import { SectionTabs } from "@/components/section-tabs";
import { ReturnDocumentUpload } from "@/components/return-document-forms";
import {
  ReturnDocumentList,
  type ReturnDocument,
} from "@/components/return-document-list";
export default async function ReturnDocuments({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    archived_page?: string;
    history_page?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { db } = await requireAdmin();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const pageNumber = (s?: string) =>
    Math.max(1, Math.min(10000, Math.floor(Number(s) || 1)));
  const page = pageNumber(query.page),
    archivedPage = pageNumber(query.archived_page),
    historyPage = pageNumber(query.history_page);
  const [record, active, archived, events] = await Promise.all([
    db
      .from("supplier_returns")
      .select("id,vendor,reason,cancelled_at")
      .eq("id", id)
      .maybeSingle(),
    db
      .from("supplier_return_documents")
      .select("*", { count: "exact" })
      .eq("return_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 25, page * 25 - 1),
    db
      .from("supplier_return_documents")
      .select("*", { count: "exact" })
      .eq("return_id", id)
      .not("archived_at", "is", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range((archivedPage - 1) * 25, archivedPage * 25 - 1),
    db
      .from("supplier_return_document_events")
      .select(
        "id,operation,reason,created_at,supplier_return_documents!inner(return_id,file_name)",
        { count: "exact" },
      )
      .eq("supplier_return_documents.return_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((historyPage - 1) * 25, historyPage * 25 - 1),
  ]);
  if (!record.data && !record.error) notFound();
  const failed = record.error || active.error || archived.error || events.error;
  return (
    <>
      <Link
        className="text-link"
        href={`/admin/inventory?section=returns&return=${id}#return-${id}`}
      >
        Back to supplier return
      </Link>
      <PageHeading
        title="Return documents"
        description={
          record.data
            ? `${record.data.vendor} · ${record.data.reason}`
            : "Private supplier return documentation"
        }
      />
      <Notice
        error={
          failed
            ? "Documents could not load. Confirm the latest migration has completed, then refresh."
            : undefined
        }
      />
      {record.data?.cancelled_at && (
        <p className="notice">
          This return was cancelled. Its documentation is retained.
        </p>
      )}
      {!failed && (
        <>
          <div className="row-actions">
            <ActionPanel id="attach-return-document" label="Add document">
              <ReturnDocumentUpload returnId={id} />
            </ActionPanel>
          </div>
          <SectionTabs
            id="return-docs"
            label="Return documentation"
            defaultTab={
              query.history_page
                ? "history"
                : query.archived_page
                  ? "archived"
                  : "active"
            }
            sections={[
              {
                id: "active",
                label: `Documents (${active.count ?? 0})`,
                content: (
                  <ReturnDocumentList
                    documents={(active.data ?? []) as ReturnDocument[]}
                    returnId={id}
                    archived={false}
                    page={page}
                    total={active.count ?? 0}
                  />
                ),
              },
              {
                id: "archived",
                label: `Archived (${archived.count ?? 0})`,
                content: (
                  <ReturnDocumentList
                    documents={(archived.data ?? []) as ReturnDocument[]}
                    returnId={id}
                    archived
                    page={archivedPage}
                    total={archived.count ?? 0}
                  />
                ),
              },
              {
                id: "history",
                label: "Correction history",
                content: (
                  <>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Documentation corrections</h2>
                      </div>
                      {events.data?.length ? (
                        events.data.map((e) => (
                          <div className="record-form separated" key={e.id}>
                            <strong>
                              {
                                (
                                  e.supplier_return_documents as unknown as {
                                    file_name: string;
                                  }
                                ).file_name
                              }
                            </strong>
                            <p>
                              {e.operation === "archive"
                                ? "Archived"
                                : "Restored"}{" "}
                              ·{" "}
                              {new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                                timeZone: "America/Chicago",
                              }).format(new Date(e.created_at))}
                            </p>
                            <p className="return-document-reason">{e.reason}</p>
                          </div>
                        ))
                      ) : (
                        <p className="record-form muted">
                          No document corrections recorded.
                        </p>
                      )}
                    </section>
                    <nav
                      className="row-actions"
                      aria-label="Document correction pages"
                    >
                      {historyPage > 1 && (
                        <Link
                          className="button secondary"
                          href={`?history_page=${historyPage - 1}#return-docs-history`}
                        >
                          Newer corrections
                        </Link>
                      )}
                      {historyPage * 25 < (events.count ?? 0) && (
                        <Link
                          className="button secondary"
                          href={`?history_page=${historyPage + 1}#return-docs-history`}
                        >
                          Older corrections
                        </Link>
                      )}
                    </nav>
                  </>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
