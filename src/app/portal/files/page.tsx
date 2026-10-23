import { HorseVideoPlayer } from "@/components/horse-video-player";
import { AppSelect } from "@/components/app-select";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { PageHeading } from "@/components/ui";
export default async function CustomerFiles({
  searchParams,
}: {
  searchParams: Promise<{ horse?: string; page?: string }>;
}) {
  const q = await searchParams;
  const { db } = await requireCustomer();
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const horse = q.horse && /^[0-9a-f-]{36}$/i.test(q.horse) ? q.horse : null;
  const [files, horses] = await Promise.all([
    db.rpc("portal_files", { p_horse: horse, p_page: page }),
    db.rpc("portal_horses"),
  ]);
  const href = (next: number) =>
    `/portal/files?page=${next}${horse ? `&horse=${horse}` : ""}`;
  return (
    <>
      <PageHeading
        eyebrow="A CLOSER LOOK"
        title="Photos, videos & documents"
        description="Files your trainer has deliberately shared with you for your horses."
      />
      {files.error || horses.error ? (
        <p className="notice error" role="alert">
          Your files couldn’t load. Please try again.
        </p>
      ) : (
        <>
          <section className="panel">
            <form method="get" className="log-filter">
              <label>
                Horse
                <AppSelect name="horse" defaultValue={horse ?? ""}>
                  <option value="">All shared horses</option>
                  {horses.data?.map((h: { id: string; barn_name: string }) => (
                    <option key={h.id} value={h.id}>
                      {h.barn_name}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <button className="button secondary" type="submit">
                Show files
              </button>
            </form>
          </section>
          <div className="customer-horse-grid">
            {files.data?.rows?.map(
              (f: {
                id: string;
                title: string;
                horse_name: string;
                kind: string;
                content_type: string;
                file_name: string;
              }) => (
                <article className="panel customer-horse-card" key={f.id}>
                  {f.content_type.startsWith("image/") && (
                    <img
                      className="horse-file-thumb"
                      src={`/portal/files/${f.id}`}
                      alt={f.title}
                      loading="lazy"
                    />
                  )}
                  {f.kind === "video" && (
                    <HorseVideoPlayer
                      src={`/portal/files/${f.id}`}
                      title={f.title}
                    />
                  )}
                  <p className="eyebrow">
                    {f.horse_name} · {f.kind}
                  </p>
                  <h2>{f.title}</h2>
                  <p className="muted">{f.file_name}</p>
                  <div className="row-actions">
                    <a
                      href={`/portal/files/${f.id}`}
                      className="text-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open file
                    </a>
                    <a
                      href={`/portal/files/${f.id}?download=1`}
                      className="text-link"
                    >
                      Download
                    </a>
                  </div>
                </article>
              ),
            )}
          </div>
          {!files.data?.rows?.length && (
            <p className="notice">
              No published files have been shared in this view yet.
            </p>
          )}
          <nav className="log-pagination" aria-label="Shared file pages">
            {page > 1 ? (
              <Link className="button secondary" href={href(page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>Page {page}</span>
            {page * 24 < Number(files.data?.total ?? 0) ? (
              <Link className="button secondary" href={href(page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </>
  );
}
