import { SectionTabs } from "@/components/section-tabs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import { ActionPanel } from "@/components/action-panel";
import { VideoUploadStatusForm } from "@/components/video-upload-status-form";
export default async function UploadDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; success?: string }>;
}) {
  const { id } = await params,
    q = await searchParams;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const { db } = await requireAdmin();
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const [result, history] = await Promise.all([
    db
      .from("horse_video_uploads")
      .select(
        "id,horse_id,title,file_name,size_bytes,created_at,attached_at,abandoned_at,abandoned_reason,revision",
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("horse_video_upload_events")
      .select("id,action,reason,created_at", { count: "exact" })
      .eq("upload_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 25, page * 25 - 1),
  ]);
  if (result.error)
    return (
      <Notice error="Upload details could not load. Check the latest migration and retry." />
    );
  const upload = result.data;
  if (!upload) notFound();
  const horse = await db
    .from("horses")
    .select("barn_name")
    .eq("id", upload.horse_id)
    .maybeSingle();
  const timestamp = (value: string) =>
    `${new Date(value).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central`;
  const abandoned = !!upload.abandoned_at;
  return (
    <>
      <PageHeading
        title={upload.title}
        eyebrow="VIDEO UPLOAD"
        description={horse.data?.barn_name ?? "Horse record"}
      />
      <Notice success={q.success} />
      <div className="row-actions">
        <Link
          className="button secondary"
          href={`/admin/files#horse-files-${upload.attached_at ? "library" : abandoned ? "aside" : "pending"}`}
        >
          Back to uploads
        </Link>
        {upload.attached_at && (
          <Link className="button" href={`/admin/files?file=${id}`}>
            Review saved video
          </Link>
        )}
      </div>
      <SectionTabs
        id="upload-details"
        label="Upload details"
        defaultTab={q.page ? "history" : "overview"}
        sections={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <section className="panel">
                <div className="record-form">
                  <span className="tag">
                    {upload.attached_at
                      ? "Saved in file library"
                      : abandoned
                        ? "Set aside"
                        : "Pending"}
                  </span>
                  <p>
                    {upload.file_name} ·{" "}
                    {(upload.size_bytes / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <p className="muted">
                    Prepared {timestamp(upload.created_at)}
                  </p>
                  {abandoned && (
                    <div className="notice">
                      <p>Set aside {timestamp(upload.abandoned_at!)}</p>
                      <p>{upload.abandoned_reason}</p>
                    </div>
                  )}
                  {!upload.attached_at && (
                    <ActionPanel
                      id="change-upload-status"
                      label={abandoned ? "Restore upload" : "Set aside upload"}
                    >
                      <VideoUploadStatusForm
                        id={id}
                        revision={upload.revision}
                        abandoned={abandoned}
                      />
                    </ActionPanel>
                  )}
                </div>
              </section>
            ),
          },
          {
            id: "history",
            label: "Status history",
            content: (
              <section className="panel">
                <div className="record-form">
                  <h2>Upload status history</h2>
                  {history.error ? (
                    <p className="notice error" role="alert">
                      History could not load. Refresh to retry.
                    </p>
                  ) : (
                    <>
                      {!history.data?.length && (
                        <p className="muted">No status changes on this page.</p>
                      )}
                      {history.data?.map((event) => (
                        <article className="separated" key={event.id}>
                          <h3>
                            {event.action === "abandon"
                              ? "Set aside"
                              : "Restored to pending"}
                          </h3>
                          <p>{event.reason}</p>
                          <small className="muted">
                            {timestamp(event.created_at)}
                          </small>
                        </article>
                      ))}
                      <nav
                        className="log-pagination"
                        aria-label="Upload status history pages"
                      >
                        {page > 1 ? (
                          <Link
                            className="button secondary"
                            href={`?page=${page - 1}`}
                          >
                            Previous
                          </Link>
                        ) : (
                          <span />
                        )}
                        <span>Page {page}</span>
                        {page * 25 < (history.count ?? 0) ? (
                          <Link
                            className="button secondary"
                            href={`?page=${page + 1}`}
                          >
                            Next
                          </Link>
                        ) : (
                          <span />
                        )}
                      </nav>
                    </>
                  )}
                </div>
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
