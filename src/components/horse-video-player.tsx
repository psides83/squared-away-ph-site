"use client";
import { useState } from "react";
export function HorseVideoPlayer({
  src,
  title,
  poster,
}: {
  src: string;
  title: string;
  poster?: string;
}) {
  const [revision, setRevision] = useState(0),
    [error, setError] = useState(false);
  return (
    <div>
      <video
        key={revision}
        className="horse-video-player"
        controls
        poster={poster}
        playsInline
        preload="none"
        src={`${src}?playback=${revision}`}
        aria-label={title}
        onError={() => setError(true)}
      >
        <a href={`${src}?download=1`}>Download video</a>
      </video>
      {error && (
        <div className="stack">
          <p className="muted">
            Video unavailable or unsupported on this device. Reload to request
            fresh access, or download the original clip.
          </p>
          <div className="row-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setError(false);
                setRevision((n) => n + 1);
              }}
            >
              Reload video
            </button>
            <a className="text-link" href={`${src}?download=1`}>
              Download video
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
