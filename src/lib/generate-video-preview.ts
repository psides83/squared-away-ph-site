import { previewDimensions, videoPreviewLimit } from "./video-preview.ts";
/** Capture locally; never fetch a private video again to generate its preview. */
export function generateVideoPreview(
  file: Blob,
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error("Preview cancelled."));
      return;
    }
    const video = document.createElement("video"),
      canvas = document.createElement("canvas");
    const url = URL.createObjectURL(file);
    let done = false,
      capturing = false,
      target = 0;
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          Error("This device could not generate a preview in time."),
        ),
      8000,
    );
    const cancel = () => finish(undefined, Error("Preview cancelled."));
    function finish(blob?: Blob, error?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else reject(error ?? Error("Preview unavailable."));
    }
    function capture() {
      if (
        done ||
        capturing ||
        video.seeking ||
        video.readyState < 2 ||
        Math.abs(video.currentTime - target) > 0.15
      )
        return;
      capturing = true;
      try {
        const size = previewDimensions(video.videoWidth, video.videoHeight);
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) throw Error("Preview unavailable.");
        context.drawImage(video, 0, 0, size.width, size.height);
        canvas.toBlob(
          (blob) => {
            if (
              blob &&
              blob.type === "image/jpeg" &&
              blob.size > 0 &&
              blob.size <= videoPreviewLimit
            )
              finish(blob);
            else finish(undefined, Error("Preview unavailable."));
          },
          "image/jpeg",
          0.78,
        );
      } catch {
        finish(undefined, Error("This device could not generate a preview."));
      }
    }
    signal?.addEventListener("abort", cancel, { once: true });
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      try {
        previewDimensions(video.videoWidth, video.videoHeight);
        target =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(1, video.duration / 2)
            : 0;
        if (target > 0) video.currentTime = target;
        else capture();
      } catch {
        finish(undefined, Error("Video metadata is unavailable."));
      }
    };
    video.onloadeddata = capture;
    video.onseeked = capture;
    video.onerror = () =>
      finish(undefined, Error("This device cannot decode a video preview."));
    try {
      video.src = url;
      video.load();
    } catch {
      finish(undefined, Error("Video preview could not load."));
    }
  });
}
