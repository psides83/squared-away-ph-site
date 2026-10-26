"use client";
import { useEffect, useRef, useState } from "react";
import { generateVideoPreview } from "@/lib/generate-video-preview";
import { saveVideoPreview } from "@/app/admin/files/preview-actions";
import { Upload } from "tus-js-client";
import { useRouter } from "next/navigation";
import { AppSelect } from "@/components/app-select";
import { HelpPanel } from "@/components/help-panel";
import { FilePicker } from "@/components/file-picker";
import { Field } from "@/components/ui";
import { prepareVideo, finishVideo } from "@/app/admin/files/video-actions";
import {
  videoType,
  videoSize,
  videoDigest,
  verifyVideoReselection,
  safeVideoTransferUrl,
  videoTransferFingerprint,
  matchingVideoTransfer,
  type PendingVideoTransfer,
} from "@/lib/horse-video";
type Work = {
  id: string;
  file: File;
  form: FormData;
  uploaded: boolean;
  upload?: Upload;
  token?: string;
  previewAbort?: AbortController;
};
export function HorseVideoUpload({
  horses,
  horse,
  userId,
  resume,
}: {
  horses: { id: string; barn_name: string }[];
  horse?: string | null;
  userId: string;
  resume?: PendingVideoTransfer;
}) {
  const router = useRouter(),
    work = useRef<Work | null>(null),
    mounted = useRef(true),
    locked = useRef(false);
  const selecting = useRef(false);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [stage, setStage] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void work.current?.upload?.abort();
      work.current?.previewAbort?.abort();
    };
  }, []);
  async function run() {
    if (locked.current || !work.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const item = work.current;
    try {
      if (!item.uploaded) {
        setStage("Preparing private upload…");
        const info = await prepareVideo(item.form);
        if (!info.ok) throw Error(info.error);
        if (!mounted.current) return;
        if (info.attached) {
          item.uploaded = true;
          await complete(item);
          return;
        }
        item.token = info.token;
        if (!item.upload)
          item.upload = new Upload(item.file, {
            endpoint: info.endpoint,
            headers: {
              apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            },
            chunkSize: 6 * 1024 * 1024,
            uploadDataDuringCreation: true,
            storeFingerprintForResuming: true,
            fingerprint: async () =>
              videoTransferFingerprint(
                userId,
                item.id,
                String(item.form.get("sha256")),
              ),

            removeFingerprintOnSuccess: true,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            metadata: {
              bucketName: "horse-videos",
              objectName: info.path,
              contentType: String(item.form.get("content_type")),
              cacheControl: "0",
            },
            onBeforeRequest: (req) => {
              if (!safeVideoTransferUrl(req.getURL(), info.endpoint))
                throw Error(
                  "The saved transfer address is invalid. Start a new upload.",
                );
              req.setHeader("x-signature", item.token!);
            },
            onProgress: (sent, total) => {
              if (mounted.current)
                setProgress(Math.round((sent * 100) / total));
            },
            onError: () => {
              if (mounted.current && work.current === item) {
                setBusy(false);
                setError(
                  "Upload interrupted. Retry here, or reopen this video from Pending uploads and select the original file.",
                );
              }
              if (work.current === item) locked.current = false;
            },
            onSuccess: () => {
              item.uploaded = true;
              void complete(item);
            },
          });
        const previous = await item.upload
          .findPreviousUploads()
          .catch(() => []);
        if (!mounted.current || work.current !== item) return;
        const saved = matchingVideoTransfer(
          previous,
          info.endpoint,
          info.path,
          item.file.size,
        );
        if (saved && !item.upload.url)
          item.upload.resumeFromPreviousUpload(saved);
        setStage(saved ? "Resuming private upload…" : "Uploading privately…");
        item.upload.start();
      } else await complete(item);
    } catch (e) {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        setError(
          e instanceof Error
            ? e.message
            : "Video upload failed. Retry while this editor stays open.",
        );
      }
    }
  }
  async function complete(item: Work) {
    if (!mounted.current || work.current !== item) return;
    setStage("Saving private video record…");
    try {
      const result = await finishVideo(item.id);
      if (!result.ok) throw Error(result.error);
      if (!mounted.current || work.current !== item) return;
      let previewSaved = result.previewSaved;
      if (!previewSaved) {
        setStage("Creating a small video preview…");
        item.previewAbort = new AbortController();
        try {
          const image = await generateVideoPreview(
            item.file,
            item.previewAbort.signal,
          );
          if (!mounted.current || work.current !== item) return;
          const form = new FormData();
          form.set("file_id", item.id);
          form.set("preview", image, "preview.jpg");
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timedOut = new Promise<{ ok: boolean }>((resolve) => {
              timer = setTimeout(() => resolve({ ok: false }), 8000);
            });
            previewSaved = (
              await Promise.race([saveVideoPreview(form), timedOut])
            ).ok;
          } finally {
            if (timer) clearTimeout(timer);
          }
        } catch {
          previewSaved = false;
        }
      }
      if (mounted.current && work.current === item) {
        const message = previewSaved
          ? "Video saved with a private preview. Review before sharing."
          : "Video saved. A preview could not be confirmed; the video is available to review.";
        router.push(
          `/admin/files?file=${item.id}&success=${encodeURIComponent(message)}`,
        );
        router.refresh();
      }
    } catch (e) {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        setError(
          e instanceof Error
            ? e.message
            : "Video uploaded; retry saving its record.",
        );
      }
    }
  }
  async function submit(form: HTMLFormElement) {
    if (work.current) return run();
    if (selecting.current) return;
    selecting.current = true;
    try {
      const data = new FormData(form);
      const file = data.get("file");
      if (!(file instanceof File)) throw Error("Choose a video first.");
      videoSize(file.size);
      setBusy(true);
      setError("");
      setStage("Checking video contents…");
      const type = videoType(
        new Uint8Array(await file.slice(0, 65536).arrayBuffer()),
      );
      const sha256 = await videoDigest(await file.arrayBuffer());
      if (!mounted.current) return;
      if (resume) verifyVideoReselection(file, type.mime, sha256, resume);
      const id = resume?.id ?? crypto.randomUUID();
      const meta = new FormData();
      for (const field of ["horse_id", "title"])
        meta.set(field, String(data.get(field) ?? ""));
      if (resume) {
        meta.set("horse_id", resume.horse_id);
        meta.set("title", resume.title);
      }
      meta.set("upload_id", id);
      meta.set("sha256", sha256);
      meta.set(
        "file_name",
        (resume?.file_name ??
          file.name.replace(/[\r\n\0]/g, "").slice(0, 200)) ||
          `horse-video.${type.extension}`,
      );
      meta.set("content_type", type.mime);
      meta.set("size", String(file.size));
      work.current = { id, file, form: meta, uploaded: false };
      setPending(true);
      await run();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Choose a supported video.");
    } finally {
      selecting.current = false;
    }
  }
  return (
    <form
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <fieldset className="video-fields" disabled={pending}>
        {resume ? (
          <div className="notice">
            <strong>{resume.title}</strong>
            <p>
              Select the original video: {resume.file_name}. Its contents will
              be verified before resuming.
            </p>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              Horse
              <AppSelect
                aria-label="Video horse"
                name="horse_id"
                required
                defaultValue={horse ?? ""}
              >
                <option value="">Choose horse</option>
                {horses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.barn_name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <Field
              label="Video title (visible if shared)"
              name="title"
              required
              maxLength={200}
            />
          </div>
        )}
        <label>
          MP4, MOV, or WebM · up to 50 MB
          <FilePicker
            name="file"
            required
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          />
        </label>
      </fieldset>
      <p className="form-hint muted">
        Videos start private. You can reopen unfinished videos from Pending
        uploads.
      </p>
      <HelpPanel title="Upload and playback details">
        <p>
          After closing this editor, select the original file again to continue.
          Transfer progress can resume on this browser while its saved transfer
          is available (up to 24 hours); otherwise it starts again in the same
          record. Clearing browser data removes saved transfer progress. Clips
          are not kept in browser storage.
        </p>
        <p>
          A small preview is generated locally after the video saves. If this
          device cannot create one, the video still saves. Device playback
          depends on the clip’s codec. No video conversion is performed.
        </p>
      </HelpPanel>
      {busy && (
        <div role="status" aria-live="polite">
          <p>
            {stage} {progress}%
          </p>
          <div
            className="video-progress"
            role="progressbar"
            aria-label="Video upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button" type="submit" disabled={busy}>
          {busy
            ? "Working…"
            : pending
              ? work.current?.uploaded
                ? "Retry saving video"
                : "Retry upload"
              : resume
                ? "Resume private upload"
                : "Upload video privately"}
        </button>
        {pending && !busy && (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              void work.current?.upload?.abort();
              work.current = null;
              locked.current = false;
              setPending(false);
              setProgress(0);
              setError("");
              setStage("");
            }}
          >
            Start over
          </button>
        )}
      </div>
    </form>
  );
}
