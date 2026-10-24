"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
export function CashExportButton({ from, to }: { from: string; to: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setBusy(false);
    setError("");
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [from, to]);
  async function download() {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/admin/reports/cash-export?${new URLSearchParams({ from, to })}`,
        { signal: active.signal, cache: "no-store" },
      );
      if (response.redirected)
        throw Error("Please sign in again, then retry the export.");
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw Error(
          result?.error ?? "The cash export could not load. Please retry.",
        );
      }
      if (!response.headers.get("Content-Type")?.startsWith("text/csv"))
        throw Error(
          "The cash export could not load. Refresh the page and retry.",
        );
      const blob = await response.blob();
      if (active.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `squared-away-cash-${from}-through-${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!active.signal.aborted)
        setError(
          e instanceof Error ? e.message : "The export failed. Please retry.",
        );
    } finally {
      if (controller.current === active) {
        controller.current = null;
        if (!active.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <div>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void download()}
      >
        <Download size={18} />
        {busy ? "Preparing export…" : "Download cash CSV"}
      </button>
      {busy && (
        <p className="muted" role="status">
          Preparing the complete ledger for this period…
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
