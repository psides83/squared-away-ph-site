import { SectionTabs } from "@/components/section-tabs";
import { HelpPanel } from "@/components/help-panel";
import { recoverVideo } from "./video-actions";
import { HorseVideoPlayer } from "@/components/horse-video-player";
import { HorseVideoUpload } from "@/components/horse-video-upload";
import { FilePicker } from "@/components/file-picker";
import { AppSelect } from "@/components/app-select";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { InvoiceConfirmButton } from "@/components/invoice-buttons";
import { uploadHorseFile, changeHorseFile } from "./actions";
export default async function HorseFiles({
  searchParams,
}: {
  searchParams: Promise<{
    horse?: string;
    file?: string;
    page?: string;
    pending_page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const q = await searchParams;
  const { db, user } = await requireAdmin();
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const horse = q.horse && /^[0-9a-f-]{36}$/i.test(q.horse) ? q.horse : null;
  let list = db
    .from("horse_files")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 24, page * 24 - 1);
  if (horse) list = list.eq("horse_id", horse);
  const pendingPage = Math.max(
    1,
    Math.min(10000, Math.floor(Number(q.pending_page) || 1)),
  );
  let pendingQuery = db
    .from("horse_video_uploads")
    .select(
      "id,horse_id,title,file_name,content_type,size_bytes,created_at,sha256",
      {
        count: "exact",
      },
    )
    .is("attached_at", null)
    .order("created_at", { ascending: false })
    .order("id")
    .range((pendingPage - 1) * 24, pendingPage * 24 - 1);
  if (horse) pendingQuery = pendingQuery.eq("horse_id", horse);
  const [files, horses, selected, pendingUploads] = await Promise.all([
    list,
    db.from("horses").select("id,barn_name").order("barn_name"),
    q.file && /^[0-9a-f-]{36}$/i.test(q.file)
      ? db.from("horse_files").select("*").eq("id", q.file).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    pendingQuery,
  ]);
  const file = selected.data;
  const history = file
    ? await db
        .from("portal_admin_events")
        .select("id,kind,reason,created_at")
        .eq("file_id", file.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  const failed = [files, horses, selected, history].some((r) => r.error);
  const href = (next: number) =>
    `/admin/files?page=${next}${horse ? `&horse=${horse}` : ""}`;
  return (
    <>
      <PageHeading
        eyebrow="THE RECORD BEHIND THE HORSE"
        title="Horse photos, videos & documents"
        description="Keep files private, then deliberately share selected files with customers."
      />
      <Notice
        error={
          failed
            ? "Horse files could not load. Check the latest migration."
            : q.error
        }
        success={q.success}
      />
      <p className="notice">
        Uploads are private by default. Publishing shares the file with every
        customer whose access to that horse permits it. Keep customer-specific
        invoices, payment records, and sensitive financial receipts in their
        billing records, rather than sharing them with co-owners here.
      </p>
      <ActionPanel id="upload-horse-video" label="Upload video">
        <div className="panel-heading">
          <h2>Upload a private video</h2>
        </div>
        <HorseVideoUpload
          horses={horses.data ?? []}
          horse={horse}
          userId={user.id}
        />
      </ActionPanel>
      <ActionPanel id="upload-file" label="Upload a private file">
        <div className="panel-heading">
          <h2>Upload a private file</h2>
        </div>
        <form action={uploadHorseFile} className="record-form">
          <div className="form-grid">
            <label>
              Horse
              <AppSelect name="horse_id" required defaultValue={horse ?? ""}>
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
            <label>
              Type
              <AppSelect name="kind" defaultValue="photo">
                <option value="photo">Photo</option>
                <option value="document">Document</option>
              </AppSelect>
            </label>
          </div>
          <Field
            label="File title (visible if published)"
            name="title"
            required
            maxLength={200}
          />
          <label>
            JPEG, PNG, WebP, or PDF · up to 3 MB
            <FilePicker
              name="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
            />
          </label>
          <SubmitButton>Upload privately</SubmitButton>
          <p className="muted">
            Choose Document for PDFs. Use Upload video for MP4, MOV or WebM
            clips. Archived files are retained for owner review.
          </p>
        </form>
      </ActionPanel>
      {!failed && file && (
        <ActionPanel
          id="review-file"
          label="Review file and sharing"
          defaultOpen
          closeHref="/admin/files"
        >
          <div className="panel-heading">
            <h2>{file.title}</h2>
            <span className="tag">
              {file.archived_at
                ? "Archived"
                : file.published_at
                  ? "Published"
                  : "Private"}
            </span>
          </div>
          <div className="record-form">
            <p>
              {file.file_name} · {Math.ceil(file.size_bytes / 1024)} KB
            </p>
            {file.content_type.startsWith("image/") && (
              <img
                className="horse-file-preview"
                src={`/admin/files/${file.id}`}
                alt={file.title}
                loading="lazy"
              />
            )}
            {file.kind === "video" && (
              <HorseVideoPlayer
                src={`/admin/files/${file.id}`}
                title={file.title}
              />
            )}
            <div className="row-actions">
              <a
                className="text-link"
                href={`/admin/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open file
              </a>
              <a
                className="text-link"
                href={`/admin/files/${file.id}?download=1`}
              >
                Download
              </a>
            </div>
            {!file.archived_at && !file.published_at && (
              <form
                action={changeHorseFile.bind(null, "rename")}
                className="stack separated"
              >
                <input name="id" type="hidden" value={file.id} />
                <Field
                  label="File title"
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={file.title}
                />
                <Field
                  label="Revision reason"
                  name="reason"
                  required
                  maxLength={2000}
                />
                <SubmitButton>Save file title</SubmitButton>
              </form>
            )}
            {!file.archived_at && (
              <>
                <form
                  className="stack separated"
                  action={changeHorseFile.bind(
                    null,
                    file.published_at ? "unpublish" : "publish",
                  )}
                >
                  <input name="id" type="hidden" value={file.id} />
                  <Field
                    name="reason"
                    label="Sharing reason"
                    required
                    maxLength={2000}
                  />
                  <InvoiceConfirmButton
                    prompt={
                      file.published_at
                        ? "Unpublish this file? New portal requests will be denied. Copies already opened or downloaded are unaffected."
                        : "Publish this file to all customers with permitted access to this horse?"
                    }
                  >
                    {file.published_at
                      ? "Unpublish file"
                      : "Publish to customers"}
                  </InvoiceConfirmButton>
                </form>
                <form
                  className="stack separated"
                  action={changeHorseFile.bind(null, "archive")}
                >
                  <input name="id" type="hidden" value={file.id} />
                  <Field
                    name="reason"
                    label="Reason for archiving"
                    required
                    maxLength={2000}
                  />
                  <InvoiceConfirmButton prompt="Archive this file? It will be hidden from customers, with the owner copy and history retained.">
                    Archive file
                  </InvoiceConfirmButton>
                </form>
              </>
            )}
            <h3 className="separated">File history (latest 20)</h3>
            {history.data?.map((e) => (
              <p key={e.id}>
                {e.kind.replaceAll("_", " ")} · {e.reason}
                <small className="cell-secondary">
                  {new Date(e.created_at).toLocaleString("en-US", {
                    timeZone: "America/Chicago",
                  })}{" "}
                  Central
                </small>
              </p>
            ))}
          </div>
        </ActionPanel>
      )}
      <SectionTabs
        id="horse-files"
        label="Horse file views"
        defaultTab={q.pending_page ? "pending" : "library"}
        sections={[
          {
            id: "library",
            label: "File library",
            content: (
              <section className="panel">
                <form className="log-filter" method="get">
                  <label>
                    Horse
                    <AppSelect name="horse" defaultValue={horse ?? ""}>
                      <option value="">All horses</option>
                      {horses.data?.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.barn_name}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  <button className="button secondary" type="submit">
                    Filter files
                  </button>
                </form>
                <div className="customer-horse-grid file-grid">
                  {files.data?.map((f) => (
                    <article className="panel customer-horse-card" key={f.id}>
                      {f.content_type.startsWith("image/") && (
                        <img
                          className="horse-file-thumb"
                          src={`/admin/files/${f.id}`}
                          alt={f.title}
                          loading="lazy"
                        />
                      )}
                      <p className="eyebrow">
                        {
                          horses.data?.find((h) => h.id === f.horse_id)
                            ?.barn_name
                        }{" "}
                        · {f.kind}
                      </p>
                      <h3>{f.title}</h3>
                      <small>
                        {f.archived_at
                          ? "Archived"
                          : f.published_at
                            ? "Published"
                            : "Private"}{" "}
                        · {dateLabel(f.created_at.slice(0, 10))}
                      </small>
                      <Link
                        className="text-link"
                        href={`/admin/files?file=${f.id}${horse ? `&horse=${horse}` : ""}`}
                      >
                        Review / sharing
                      </Link>
                    </article>
                  ))}
                </div>
                {!files.data?.length && !failed && (
                  <p className="record-form muted">
                    No horse files in this view yet.
                  </p>
                )}
                <nav className="log-pagination" aria-label="Horse file pages">
                  {page > 1 ? (
                    <Link className="button secondary" href={href(page - 1)}>
                      Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span>Page {page}</span>
                  {page * 24 < (files.count ?? 0) ? (
                    <Link className="button secondary" href={href(page + 1)}>
                      Next
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              </section>
            ),
          },
          {
            id: "pending",
            label: `Pending uploads${pendingUploads.count ? ` (${pendingUploads.count})` : ""}`,
            content: (
              <section className="panel">
                <div className="record-form">
                  <h2>Recover a video save</h2>
                  <p className="muted">
                    These videos were prepared but have not been added to the
                    file library. Check a video to finish saving it privately if
                    its upload reached storage.
                  </p>
                  <HelpPanel title="What if an upload is incomplete?">
                    <p>
                      Select Resume upload and choose the original video again.
                      Its contents are checked before continuing. The same
                      browser can resume a saved transfer for up to 24 hours;
                      otherwise it starts again in the same pending record.
                      Older entries without Resume upload need a fresh upload.
                      Pending entries are retained; this view does not delete
                      storage or publish videos.
                    </p>
                  </HelpPanel>
                  {pendingUploads.error ? (
                    <p className="notice error" role="alert">
                      Pending uploads could not load. Refresh to retry.
                    </p>
                  ) : (
                    <>
                      {horse && (
                        <p className="muted">
                          Showing pending videos for{" "}
                          {horses.data?.find((h) => h.id === horse)
                            ?.barn_name ?? "the selected horse"}
                          .{" "}
                          <Link
                            className="text-link"
                            href="/admin/files#horse-files-pending"
                          >
                            Show all horses
                          </Link>
                        </p>
                      )}
                      <div className="customer-horse-grid">
                        {pendingUploads.data?.map((upload) => (
                          <article
                            className="panel customer-horse-card"
                            key={upload.id}
                          >
                            <p className="eyebrow">
                              {horses.data?.find(
                                (h) => h.id === upload.horse_id,
                              )?.barn_name ?? "Horse record"}
                            </p>
                            <h3>{upload.title}</h3>
                            <p className="muted">
                              {upload.file_name} ·{" "}
                              {(upload.size_bytes / 1024 / 1024).toFixed(1)} MB
                            </p>
                            <small>
                              Prepared{" "}
                              {new Date(upload.created_at).toLocaleString(
                                "en-US",
                                { timeZone: "America/Chicago" },
                              )}{" "}
                              Central
                            </small>
                            <form
                              action={recoverVideo}
                              className="form-actions"
                            >
                              <input
                                type="hidden"
                                name="upload_id"
                                value={upload.id}
                              />
                              <SubmitButton>
                                Check &amp; finish save
                              </SubmitButton>
                            </form>
                            {upload.sha256 && (
                              <ActionPanel
                                id={`resume-video-${upload.id}`}
                                label="Resume upload"
                              >
                                <HorseVideoUpload
                                  horses={horses.data ?? []}
                                  userId={user.id}
                                  resume={{ ...upload, sha256: upload.sha256 }}
                                />
                              </ActionPanel>
                            )}
                          </article>
                        ))}
                      </div>
                      {!pendingUploads.data?.length && (
                        <p className="muted">
                          No pending video uploads in this view.
                        </p>
                      )}
                      <nav
                        className="log-pagination"
                        aria-label="Pending upload pages"
                      >
                        {pendingPage > 1 ? (
                          <Link
                            className="button secondary"
                            href={`/admin/files?pending_page=${pendingPage - 1}${horse ? `&horse=${horse}` : ""}#horse-files-pending`}
                          >
                            Previous
                          </Link>
                        ) : (
                          <span />
                        )}
                        <span>Page {pendingPage}</span>
                        {pendingPage * 24 < (pendingUploads.count ?? 0) ? (
                          <Link
                            className="button secondary"
                            href={`/admin/files?pending_page=${pendingPage + 1}${horse ? `&horse=${horse}` : ""}#horse-files-pending`}
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
