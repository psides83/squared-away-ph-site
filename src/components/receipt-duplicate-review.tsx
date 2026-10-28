"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FormInput } from "@/components/form-input";
import { dateLabel, money } from "@/lib/format";
import type { ReceiptDuplicateReview as DuplicateReview } from "@/lib/receipt-duplicates";
export function ReceiptDuplicateReview({
  review,
  acknowledged,
  onAcknowledge,
  reason,
  onReason,
}: {
  review: DuplicateReview;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  reason: string;
  onReason: (value: string) => void;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [review.token]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>This receipt file was used before</h2>
      </div>
      <div className="record-form stack">
        <p className="notice">
          {review.count} active expense{review.count === 1 ? "" : "s"} already
          use{review.count === 1 ? "s" : ""} this exact file. Nothing new has
          been recorded. Open the saved records first; attachment failures do
          not mean the purchase needs entering again.
        </p>
        {review.matches.slice(page * 10, page * 10 + 10).map((match) => (
          <article className="customer-invoice-row" key={match.id}>
            <h3>{match.vendor || "Saved expense"}</h3>
            <p>
              {dateLabel(match.expense_date)} ·{" "}
              <strong>{money(match.amount_cents)}</strong>
            </p>
            <Link
              className="button secondary"
              href={`/admin/expenses/${match.id}`}
              target="_blank"
              rel="noreferrer"
            >
              View existing expense
            </Link>
          </article>
        ))}
        {review.matches.length > 10 && (
          <nav
            className="log-pagination"
            aria-label="Matching receipt expenses"
          >
            <button
              type="button"
              className="button secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              {page + 1} / {Math.ceil(review.matches.length / 10)}
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={(page + 1) * 10 >= review.matches.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </nav>
        )}
        <p className="muted form-hint">
          Exact file matches are a warning, not proof of a duplicate purchase. A
          different photo, crop or re-encoded file may not match. Existing
          expense links open separately to preserve this draft.
        </p>
        <input
          name="duplicate_review_token"
          type="hidden"
          value={review.token}
        />
        <label className="inline-checkbox">
          <input
            type="checkbox"
            name="duplicate_ack"
            required
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
          />
          This is a separate purchase, and I reviewed the existing records.
        </label>
        <label className="field">
          Why is another purchase needed?
          <FormInput
            name="duplicate_reason"
            aria-label="Why is another purchase needed?"
            maxLength={2000}
            required
            disabled={!acknowledged}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
          />
        </label>
        <p className="muted form-hint">
          Your explanation and the matching-record snapshot stay in the private
          receipt history.
        </p>
      </div>
    </section>
  );
}
