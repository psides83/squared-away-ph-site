"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
export function FilePicker({
  name,
  accept,
  required = false,
}: {
  name: string;
  accept: string;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    id = useId();
  const [filename, setFilename] = useState("");
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => setFilename("");
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);
  return (
    <span className="app-file-picker">
      <input
        ref={input}
        type="file"
        className="app-validation-control"
        data-app-trigger={id}
        name={name}
        accept={accept}
        required={required}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => setFilename(e.target.files?.[0]?.name ?? "")}
      />
      <button
        id={id}
        className="button secondary"
        type="button"
        onClick={() => input.current?.click()}
      >
        <Paperclip size={18} />
        Choose file
      </button>
      {filename && (
        <>
          <span className="file-name">{filename}</span>
          <button
            type="button"
            className="dialog-close"
            aria-label="Remove selected file"
            onClick={() => {
              if (input.current) input.current.value = "";
              setFilename("");
            }}
          >
            <X size={18} />
          </button>
        </>
      )}
    </span>
  );
}
