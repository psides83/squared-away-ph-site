"use client";
import { useActionState, startTransition, useState } from "react";
import {
  attachReturnDocument,
  archiveReturnDocument,
} from "@/app/admin/inventory/returns/document-actions";
import { ReceiptPicker } from "@/components/receipt-picker";
import { AppSelect } from "@/components/app-select";
import { Field, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
export function ReturnDocumentUpload({ returnId }: { returnId: string }) {
  const [state, action, pending] = useActionState(attachReturnDocument, {});
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="return_id" value={returnId} />
        <label className="field">
          <span className="field-label">Document type</span>
          <AppSelect name="kind" defaultValue="return_slip" required>
            <option value="return_slip">Return slip</option>
            <option value="refund_confirmation">Refund confirmation</option>
            <option value="other">Other document</option>
          </AppSelect>
        </label>
        <ReceiptPicker required label="Document" />
        <p className="muted">
          Private to your admin account. Attaching a file does not record a
          return, a refund or any other financial change.
        </p>
        <div className="form-actions">
          <SubmitButton>Attach document</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
export function ReturnDocumentCorrection({
  id,
  archived,
  version,
}: {
  id: string;
  archived: boolean;
  version: string;
}) {
  const [state, action, pending] = useActionState(archiveReturnDocument, {});
  const [expected] = useState(version);
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="document_id" value={id} />
        <input type="hidden" name="expected" value={expected} />
        <input
          type="hidden"
          name="operation"
          value={archived ? "restore" : "archive"}
        />
        <Field
          name="reason"
          label="Correction reason"
          required
          maxLength={2000}
        />
        <ConfirmButton
          destructive={!archived}
          message={
            archived
              ? "Restore this document to the return’s active documents?"
              : "Archive this document? The file and correction history will be kept."
          }
        >
          {archived ? "Restore document" : "Archive document"}
        </ConfirmButton>
      </fieldset>
    </form>
  );
}
