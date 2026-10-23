"use client";
import { useId, useRef, useState } from "react";
import { Camera, Paperclip, X } from "lucide-react";
import { receiptLimit } from "@/lib/inventory";

export function ReceiptPicker({
  required = false,
  label = "Receipt",
}: {
  required?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const help = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function choose(camera: boolean) {
    const field = input.current;
    if (!field) return;
    if (camera) {
      field.accept = "image/*";
      field.setAttribute("capture", "environment");
    } else {
      field.accept = "image/jpeg,image/png,image/webp,application/pdf";
      field.removeAttribute("capture");
    }
    field.click();
  }
  async function prepare() {
    const field = input.current,
      file = field?.files?.[0];
    if (!field || !file) return;
    setError("");
    setBusy(true);
    field.setCustomValidity("Wait for receipt preparation to finish.");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error(
          "Choose a receipt photo under 20 MB, or a PDF under 3 MB.",
        );
      let ready = file;
      if (
        file.type.startsWith("image/") &&
        (file.size > receiptLimit ||
          !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      ) {
        const bitmap = await createImageBitmap(file, {
          imageOrientation: "from-image",
        });
        const ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * ratio);
        canvas.height = Math.round(bitmap.height * ratio);
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error(
            "This browser could not prepare the photo. Choose a smaller JPEG instead.",
          );
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        let blob: Blob | null = null;
        for (const quality of [0.9, 0.75, 0.6]) {
          blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", quality),
          );
          if (blob && blob.size <= receiptLimit) break;
        }
        if (!blob || blob.size > receiptLimit)
          throw new Error(
            "The photo is still too large. Crop the receipt or choose a smaller image.",
          );
        ready = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
          type: "image/jpeg",
        });
        const transfer = new DataTransfer();
        transfer.items.add(ready);
        field.files = transfer.files;
      }
      if (ready.size > receiptLimit)
        throw new Error(
          "Choose a receipt under 3 MB. Photos can be reduced automatically; PDFs must already fit.",
        );
      setName(ready.name);
    } catch (e) {
      field.value = "";
      setName("");
      setError(
        e instanceof Error
          ? e.message
          : "Could not prepare this photo. Choose a JPEG, PNG, WebP, or PDF.",
      );
    } finally {
      field.setCustomValidity("");
      setBusy(false);
    }
  }
  return (
    <fieldset className="receipt-picker">
      <legend>
        {label} {required ? "" : "(optional)"}
      </legend>
      <input
        ref={input}
        className="receipt-file-input"
        data-app-trigger={help + "-choose"}
        type="file"
        name="receipt"
        aria-label={`${label} file`}
        aria-describedby={help}
        required={required}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={prepare}
      />
      <div className="receipt-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => choose(true)}
        >
          <Camera size={18} />
          Take photo
        </button>
        <button
          type="button"
          className="text-button"
          id={help + "-choose"}
          disabled={busy}
          onClick={() => choose(false)}
        >
          <Paperclip size={17} />
          Choose file
        </button>
        {name && (
          <button
            className="text-button"
            type="button"
            aria-label={`Remove selected ${label.toLowerCase()}`}
            onClick={() => {
              if (input.current) input.current.value = "";
              setName("");
            }}
          >
            <X size={17} />
          </button>
        )}
      </div>
      <p id={help} className="muted form-hint">
        {busy
          ? "Preparing photo…"
          : name ||
            `Use your camera or choose a JPEG, PNG, WebP, or PDF. ${label} stays private. Up to 3 MB after photo preparation.`}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          Wait for the photo to finish preparing before saving.
        </p>
      )}
    </fieldset>
  );
}
