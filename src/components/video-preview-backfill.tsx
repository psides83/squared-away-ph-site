"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSavedVideo } from "@/lib/read-saved-video";
import { generateVideoPreview } from "@/lib/generate-video-preview";
import {
  saveVideoPreview,
  replaceVideoPreview,
} from "@/app/admin/files/preview-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { FormInput } from "@/components/form-input";
import { HelpPanel } from "@/components/help-panel";
export function VideoPreviewBackfill({
  file,
  existingHash,
}: {
  existingHash?: string;
  file: {
    id: string;
    title: string;
    size_bytes: number;
    content_type: string;
    published: boolean;
  };
}) {
  const router = useRouter();
  const [expected] = useState(existingHash);
  const [request, setRequest] = useState(() => crypto.randomUUID());
  const [frame, setFrame] = useState("");
  const [candidate, setCandidate] = useState<Blob | null>(null),
    [image, setImage] = useState(""),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState("");
  const active = useRef<AbortController | null>(null),
    imageUrl = useRef("");
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    },
    [],
  );
  async function generate() {
    if (active.current) return;
    const seconds = frame.trim() === "" ? undefined : Number(frame);
    if (
      seconds !== undefined &&
      (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)
    ) {
      setError("Choose a frame time between 0 and 86,400 seconds.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90000);
    setBusy(true);
    setError("");
    setStage("Reading saved video…");
    try {
      const response = await fetch(`/admin/files/${file.id}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const clip = await readSavedVideo(
        response,
        file,
        controller.signal,
        (percent) => {
          if (!controller.signal.aborted)
            setStage(`Reading saved video… ${percent}%`);
        },
      );
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      setStage("Creating preview…");
      const preview = await generateVideoPreview(
        clip,
        controller.signal,
        seconds,
      );
      if (controller.signal.aborted) return;
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      imageUrl.current = URL.createObjectURL(preview);
      setImage(imageUrl.current);
      setCandidate(preview);
      setRequest(crypto.randomUUID());
      setStage("");
    } catch (e) {
      if (
        active.current === controller &&
        (!controller.signal.aborted || timedOut)
      )
        setError(
          timedOut
            ? "The video took too long to read. Please retry when your connection is ready."
            : e instanceof TypeError
              ? "The saved video could not be read. Check your connection and sign-in, then try again."
              : e instanceof Error
                ? e.message
                : "Preview could not be created.",
        );
    } finally {
      clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted || timedOut) {
          setBusy(false);
          setStage("");
        }
      }
    }
  }
  async function save() {
    if (active.current || !candidate) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setSaving(true);
    setError("");
    setStage("Saving preview…");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const form = new FormData();
      form.set("file_id", file.id);
      form.set("preview", candidate, "preview.jpg");
      if (expected) {
        form.set("expected_hash", expected);
        form.set("request", request);
      }
      const deadline = new Promise<{ ok: boolean; error?: string }>(
        (resolve) => {
          timer = setTimeout(() => resolve({ ok: false }), 8000);
        },
      );
      const result = await Promise.race([
        expected ? replaceVideoPreview(form) : saveVideoPreview(form),
        deadline,
      ]);
      if (controller.signal.aborted) return;
      if (!result.ok)
        throw Error(
          result.error ??
            "The preview save could not be confirmed. Reopen the video to check, or retry. Your original video is unchanged.",
        );
      router.replace(
        `/admin/files?file=${file.id}&success=Preview+request+processed.+Review+the+saved+preview.`,
      );
      router.refresh();
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Preview could not be saved.",
        );
    } finally {
      if (timer) clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) {
          setBusy(false);
          setSaving(false);
          setStage("");
        }
      }
    }
  }
  return (
    <div className="record-form">
      <p>
        <strong>{file.title}</strong>
      </p>
      <p className="muted">
        Reads the full saved video (
        {file.size_bytes < 1024 * 1024
          ? `${Math.ceil(file.size_bytes / 1024)} KB`
          : `${(file.size_bytes / 1024 / 1024).toFixed(1)} MB`}
        ) to create a preview on this device.
      </p>
      <HelpPanel title="Preview details">
        <p>
          Your original video stays unchanged. The clip is read into temporary
          memory, not saved as an offline copy. This device must support its
          video format. Review the generated frame before saving. A preview for
          a published video is visible to customers who can already view that
          video.
        </p>
        <p>
          {expected
            ? "Replacing retains the previous preview and an audit entry. If another session changes the preview first, reopen this editor before saving. Retrying an already saved request never reapplies it over a newer preview."
            : "If another session saves a preview first, this action does not replace it."}{" "}
          A save already in progress may finish after closing this editor.
        </p>
      </HelpPanel>
      {expected && (
        <>
          <p className="form-hint">Current saved preview</p>
          <img
            className="horse-file-preview"
            src={`/admin/files/${file.id}?preview=1&v=${expected}`}
            alt={`Current preview for ${file.title}`}
          />
        </>
      )}
      <label className="field">
        Frame time (optional)
        <FormInput
          aria-label="Frame time in seconds"
          name="frame_seconds"
          type="number"
          min="0"
          max="86400"
          step="0.1"
          suffix="sec"
          placeholder="Automatic"
          value={frame}
          disabled={busy}
          onChange={(e) => {
            setFrame(e.target.value);
            setCandidate(null);
            setImage("");
            if (imageUrl.current) {
              URL.revokeObjectURL(imageUrl.current);
              imageUrl.current = "";
            }
          }}
        />
      </label>
      <p className="form-hint muted">
        Enter seconds from the start, such as 3.5, then generate and review that
        frame. Leave blank for an automatic frame near the beginning.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {stage && (
        <p className="muted" role="status" aria-live="polite">
          {stage}
        </p>
      )}
      {image && (
        <>
          <p className="form-hint">New preview to review</p>
          <img
            className="horse-file-preview"
            src={image}
            alt={`Generated preview for ${file.title}`}
          />
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="form-actions">
          {candidate && (
            <fieldset className="video-fields" disabled={busy}>
              <ConfirmButton
                message={
                  expected
                    ? file.published
                      ? "Replace this preview? Customers with access to the published video will see the new image. The previous preview is retained in private history. The video and its sharing settings stay unchanged."
                      : "Replace the private video’s preview? The previous preview is retained in private history. The original video and sharing settings stay unchanged."
                    : file.published
                      ? "Save this preview? Customers who can view the published video will also see its preview. The original clip and access grants stay unchanged."
                      : "Save this preview for the private video? The original clip and sharing settings stay unchanged."
                }
              >
                {expected ? "Replace video preview" : "Save video preview"}
              </ConfirmButton>
            </fieldset>
          )}
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void generate()}
          >
            {candidate ? "Generate again" : "Generate preview"}
          </button>
          {busy && !saving && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                active.current?.abort();
                active.current = null;
                setBusy(false);
                setStage("");
              }}
            >
              Cancel reading
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
