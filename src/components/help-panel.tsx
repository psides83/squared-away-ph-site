import { CircleHelp, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
/** Optional guidance stays available without crowding the working screen. */
export function HelpPanel({
  title = "How this works",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="help-panel">
      <summary>
        <CircleHelp size={18} />
        <span>{title}</span>
        <ChevronDown className="help-chevron" size={17} />
      </summary>
      <div className="help-content">{children}</div>
    </details>
  );
}
