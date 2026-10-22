"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export function InstallApp() {
  const [request, setRequest] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const query = window.matchMedia("(display-mode: standalone)");
    const check = () =>
      setInstalled(
        query.matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
      );
    check();
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    );
    const ready = (event: Event) => {
      event.preventDefault();
      setRequest(event as InstallEvent);
    };
    const done = () => {
      setInstalled(true);
      setRequest(null);
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    query.addEventListener("change", check);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
      query.removeEventListener("change", check);
    };
  }, []);
  async function install() {
    if (!request) return;
    try {
      await request.prompt();
      const choice = await request.userChoice;
      setNotice(
        choice.outcome === "accepted"
          ? "Installation requested. Open Squared Away from your home screen or apps list."
          : "You can install later from your browser’s menu.",
      );
    } catch {
      setNotice(
        "Use your browser’s menu to install or add Squared Away to your home screen.",
      );
    }
    setRequest(null);
  }
  if (installed) return null;
  return (
    <details className="install-help no-print">
      <summary>Add Squared Away to your home screen</summary>
      {request ? (
        <button type="button" className="button secondary" onClick={install}>
          Install app
        </button>
      ) : (
        <p>
          {ios
            ? "In Safari, open Share, then choose Add to Home Screen. Open the new icon to use Squared Away as an app."
            : "Open your browser’s menu and choose Install app or Add to Home Screen if available. On a Mac in Safari, use File → Add to Dock."}
        </p>
      )}
      <p className="muted">
        A network connection is required. Private records are not saved for
        offline use. Sign in with your usual account.
      </p>
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
