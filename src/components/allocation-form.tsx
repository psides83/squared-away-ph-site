"use client";
import { useState } from "react";
import { money } from "@/lib/format";
import { splitAllocation, type AllocationBasis } from "@/lib/allocations";
import { SubmitButton } from "@/components/submit-button";
import { saveAllocation } from "@/app/admin/allocations/actions";

export function AllocationForm({
  expense,
  amount,
  from,
  to,
  basis,
  request,
  savedRows,
}: {
  expense: string;
  amount: number;
  from: string;
  to: string;
  basis: AllocationBasis[];
  request: string;
  savedRows?: { horse_id: string; board_days: number }[];
}) {
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      basis.map((h) => [
        h.horse_id,
        String(
          savedRows?.find((r) => r.horse_id === h.horse_id)?.board_days ??
            (savedRows ? 0 : h.board_days),
        ),
      ]),
    ),
  );
  const maxDays = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  const valid = basis.every(
    (h) =>
      /^\d{1,3}$/.test(days[h.horse_id]) && Number(days[h.horse_id]) <= maxDays,
  );
  const rows = basis
    .map((h) => ({
      horse_id: h.horse_id,
      board_days: Number(days[h.horse_id]),
    }))
    .filter((h) => h.board_days > 0);
  const shares = valid
    ? splitAllocation(amount, rows)
    : new Map<string, number>();
  const total = rows.reduce((sum, h) => sum + h.board_days, 0);
  return (
    <form action={saveAllocation} className="record-form">
      <input type="hidden" name="request_id" value={request} />
      <input type="hidden" name="expense_id" value={expense} />
      <input type="hidden" name="period_from" value={from} />
      <input type="hidden" name="period_to" value={to} />
      <p>
        Defaults count physical training-stay days, including arrival and
        departure. Review every horse. Enter actual boarding days for your own
        horses or other time outside a training stay. A training stay or invoice
        is not required for this allocation. Zero excludes a horse.
      </p>
      {savedRows && (
        <p className="notice">
          The saved boarding counts are loaded for this period. The
          training-stay column shows current defaults for comparison; later stay
          edits do not change the saved split.
        </p>
      )}
      <button
        className="button secondary"
        type="button"
        onClick={() =>
          setDays(
            Object.fromEntries(
              basis.map((h) => [h.horse_id, String(h.board_days)]),
            ),
          )
        }
      >
        Use current training-stay defaults
      </button>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Horse</th>
              <th>Training-stay days</th>
              <th>Actual boarding days</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {basis.map((h) => (
              <tr key={h.horse_id}>
                <td>{h.horse_name}</td>
                <td>{h.board_days}</td>
                <td>
                  <label>
                    <span className="sr-only">
                      Boarding days for {h.horse_name}
                    </span>
                    <input
                      name={`days_${h.horse_id}`}
                      type="number"
                      min="0"
                      max={maxDays}
                      step="1"
                      required
                      value={days[h.horse_id]}
                      onChange={(e) =>
                        setDays({ ...days, [h.horse_id]: e.target.value })
                      }
                    />
                  </label>
                </td>
                <td>{valid ? money(shares.get(h.horse_id) ?? 0) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>
          {total} boarding days ·{" "}
          {valid && total > 0 ? money(amount) : "No allocation yet"}
        </strong>
        . Shares use boarding days, with leftover pennies assigned by largest
        remainder. Saving replaces any active split and retains its history.
      </p>
      <label>
        Reason / confirmation
        <textarea
          name="reason"
          required
          maxLength={2000}
          rows={3}
          placeholder="Confirm the boarding period, explain any changes to the default counts, and include your own horses."
        />
      </label>
      <SubmitButton>Save reviewed allocation</SubmitButton>
    </form>
  );
}
