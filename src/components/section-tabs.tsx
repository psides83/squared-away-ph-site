"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

type Section = { id: string; label: string; content: ReactNode };
/** Panels stay mounted so switching sections never drops unsaved form values. */
export function SectionTabs({
  id,
  label,
  sections,
  defaultTab,
  printTab,
}: {
  id: string;
  label: string;
  sections: Section[];
  defaultTab?: string;
  printTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? sections[0]?.id);
  const visible = sections.some((s) => s.id === active)
    ? active
    : sections[0]?.id;
  const root = useRef<HTMLDivElement>(null);
  const previousDefault = useRef(defaultTab);
  useLayoutEffect(() => {
    function followHash() {
      let hash: string;
      try {
        hash = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!hash) return;
      const target = document.getElementById(hash);
      if (!target || !root.current?.contains(target)) return;
      const panel = target.closest<HTMLElement>(`[data-tab-owner="${id}"]`);
      if (panel?.dataset.tabKey) setActive(panel.dataset.tabKey);
    }
    if (previousDefault.current !== defaultTab) {
      previousDefault.current = defaultTab;
      if (defaultTab) setActive(defaultTab);
    }
    const reveal = (event: Event) => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>(
        `[data-tab-owner="${id}"]`,
      );
      if (panel?.dataset.tabKey) setActive(panel.dataset.tabKey);
    };
    root.current?.addEventListener("reveal-tab", reveal);
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => {
      root.current?.removeEventListener("reveal-tab", reveal);
      window.removeEventListener("hashchange", followHash);
    };
  }, [id, defaultTab]);
  function select(key: string, focus = false) {
    setActive(key);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#${id}-${key}`,
    );
    const button = root.current?.querySelector<HTMLButtonElement>(
      `[role="tab"][data-key="${key}"]`,
    );
    if (focus) button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  return (
    <div
      className="tabbed-content"
      ref={root}
      onInvalidCapture={(e) => {
        e.preventDefault();
        const target = e.target as HTMLInputElement;
        const panel = target.closest<HTMLElement>(`[data-tab-owner="${id}"]`);
        if (panel?.dataset.tabKey && panel.dataset.tabKey !== visible)
          flushSync(() => setActive(panel.dataset.tabKey!));
      }}
    >
      <div className="section-tablist" role="tablist" aria-label={label}>
        {sections.map((section, index) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            id={`${id}-tab-${section.id}`}
            data-key={section.id}
            aria-selected={visible === section.id}
            aria-controls={`${id}-${section.id}`}
            tabIndex={visible === section.id ? 0 : -1}
            onClick={() => select(section.id)}
            onKeyDown={(e) => {
              const move =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (move || e.key === "Home" || e.key === "End") {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? sections.length - 1
                      : (index + move + sections.length) % sections.length;
                select(sections[next].id, true);
              }
            }}
          >
            {section.label}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <div
          key={section.id}
          role="tabpanel"
          id={`${id}-${section.id}`}
          data-tab-owner={id}
          data-tab-key={section.id}
          data-print-panel={
            (printTab ? section.id === printTab : section.id === visible)
              ? "true"
              : "false"
          }
          aria-labelledby={`${id}-tab-${section.id}`}
          hidden={visible !== section.id}
          className="section-tabpanel"
          tabIndex={0}
        >
          {section.content}
        </div>
      ))}
    </div>
  );
}
