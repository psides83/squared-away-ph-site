"use client";
import { useEffect, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { useRouter } from "next/navigation";
import { AppSelect } from "@/components/app-select";
import { FilePicker } from "@/components/file-picker";
import { Field } from "@/components/ui";
import { prepareVideo, finishVideo } from "@/app/admin/files/video-actions";
import { videoType, videoSize } from "@/lib/horse-video";
type Work = {
  id: string;
  file: File;
  form: FormData;
  uploaded: boolean;
  upload?: Upload;
  token?: string;
};
export function HorseVideoUpload({
  horses,
  horse,
}: {
  horses: { id: string; barn_name: string }[];
  horse?: string | null;
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
            storeFingerprintForResuming: false,
            removeFingerprintOnSuccess: true,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            metadata: {
              bucketName: "horse-videos",
              objectName: info.path,
              contentType: String(item.form.get("content_type")),
              cacheControl: "0",
            },
            onBeforeRequest: (req) => {
              req.setHeader("x-signature", item.token!);
            },
            onProgress: (sent, total) => {
              if (mounted.current)
                setProgress(Math.round((sent * 100) / total));
            },
            onError: () => {
              if (mounted.current) {
                setBusy(false);
                setError(
                  "Upload interrupted. Keep this editor open and retry to resume.",
                );
              }
              locked.current = false;
            },
            onSuccess: () => {
              item.uploaded = true;
              void complete(item);
            },
          });
        setStage("Uploading privately…");
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
    if (!mounted.current) return;
    setStage("Saving private video record…");
    try {
      const result = await finishVideo(item.id);
      if (!result.ok) throw Error(result.error);
      if (mounted.current) {
        router.push(
          `/admin/files?file=${item.id}&success=Private+video+uploaded.+Review+before+sharing.`,
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
      const type = videoType(
        new Uint8Array(await file.slice(0, 65536).arrayBuffer()),
      );
      const id = crypto.randomUUID();
      const meta = new FormData();
      for (const field of ["horse_id", "title"])
        meta.set(field, String(data.get(field) ?? ""));
      meta.set("upload_id", id);
      meta.set(
        "file_name",
        file.name.replace(/[\r\n\0]/g, "").slice(0, 200) ||
          `horse-video.${type.extension}`,
      );
      meta.set("content_type", type.mime);
      meta.set("size", String(file.size));
      work.current = { id, file, form: meta, uploaded: false };
      setPending(true);
      await run();
    } catch (e) {
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
        Uploads directly to private storage. Keep this editor open to resume an
        interrupted upload. Videos start private. Device playback depends on the
        clip’s codec; no video conversion is performed.
      </p>
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
