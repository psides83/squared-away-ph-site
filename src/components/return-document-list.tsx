import Link from "next/link";
import { FileText, Download } from "lucide-react";
import { ActionPanel } from "@/components/action-panel";
import { ReturnDocumentCorrection } from "@/components/return-document-forms";
export const returnDocumentLabels = {
  return_slip: "Return slip",
  refund_confirmation: "Refund confirmation",
  other: "Other document",
};
export type ReturnDocument = {
  id: string;
  version: string;
  file_name: string;
  kind: keyof typeof returnDocumentLabels;
  size_bytes: number;
  created_at: string;
  archived_at: string | null;
  archive_reason: string | null;
};
export function ReturnDocumentList({
  documents,
  returnId,
  archived,
  page,
  total,
}: {
  documents: ReturnDocument[];
  returnId: string;
  archived: boolean;
  page: number;
  total: number;
}) {
  const href = (next: number) =>
    `/admin/inventory/returns/${returnId}/documents?${archived ? "archived_page" : "page"}=${next}#return-docs-${archived ? "archived" : "active"}`;
  return (
    <>
      <div className="return-document-list">
        {documents.map((d) => (
          <article className="panel" key={d.id}>
            <div className="record-form">
              <div className="return-document-heading">
                <FileText size={22} aria-hidden="true" />
                <div>
                  <h3 className="return-document-name">{d.file_name}</h3>
                  <p className="muted">
                    {returnDocumentLabels[d.kind]} ·{" "}
                    {(d.size_bytes / 1024).toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    KB ·{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "America/Chicago",
                    }).format(new Date(d.created_at))}
                  </p>
                </div>
              </div>
              {d.archived_at && (
                <p className="muted">Archived: {d.archive_reason}</p>
              )}
              <div className="row-actions">
                <a
                  className="button secondary"
                  href={`/admin/inventory/returns/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={17} aria-hidden="true" />
                  Download
                </a>
                <ActionPanel
                  id={`document-${d.id}`}
                  label={archived ? "Restore document" : "Archive document"}
                >
                  <ReturnDocumentCorrection
                    id={d.id}
                    version={d.version}
                    archived={archived}
                  />
                </ActionPanel>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!documents.length && (
        <section className="panel record-form">
          <p>
            {archived
              ? "No archived documents."
              : "No documents attached yet. Add a return slip or refund confirmation when you have one."}
          </p>
        </section>
      )}
      <nav
        className="row-actions"
        aria-label={archived ? "Archived document pages" : "Document pages"}
      >
        {page > 1 && (
          <Link className="button secondary" href={href(page - 1)}>
            Previous documents
          </Link>
        )}
        {page * 25 < total && (
          <Link className="button secondary" href={href(page + 1)}>
            More documents
          </Link>
        )}
      </nav>
    </>
  );
}
