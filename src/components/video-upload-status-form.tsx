"use client";
import { startTransition, useActionState, useRef } from "react";
import { changeVideoUpload } from "@/app/admin/files/video-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Field } from "@/components/ui";
export function VideoUploadStatusForm({
  id,
  revision,
  abandoned,
}: {
  id: string;
  revision: number;
  abandoned: boolean;
}) {
  const request = useRef<string | null>(null);
  const [state, action, pending] = useActionState(changeVideoUpload, {});
  return (
    <form
      className="record-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("request", (request.current ??= crypto.randomUUID()));
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="upload_id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <input
        type="hidden"
        name="change"
        value={abandoned ? "restore" : "abandon"}
      />
      <p className="muted">
        {abandoned
          ? "Return this upload to Pending uploads to resume its transfer or finish its private save."
          : "Remove this unfinished upload from the pending queue. Its record and any stored video are retained, and you can restore it later. An active transfer may still finish in storage."}
      </p>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <fieldset disabled={pending} className="video-fields">
        <Field
          label={
            abandoned ? "Reason for restoring" : "Reason for setting aside"
          }
          name="reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton
            message={
              abandoned
                ? "Restore this upload to the pending queue? It stays private."
                : "Set aside this upload? Its record and stored video will be retained. Saving and resuming through the app will be blocked until it is restored."
            }
          >
            {abandoned ? "Restore to pending" : "Set aside upload"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
