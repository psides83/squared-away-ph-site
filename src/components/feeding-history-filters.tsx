import Form from "next/form";
import { ClearFeedingHistoryFilters } from "@/components/feeding-history-clear";
import { AppSelect } from "@/components/app-select";
import { TemporalInput } from "@/components/temporal-input";
import { FormInput } from "@/components/form-input";
import {
  feedingHistoryUrl,
  type FeedingHistoryFilters,
} from "@/lib/feeding-history";
export function FeedingHistoryFilterForm({
  filters,
  horses,
  planHorse,
}: {
  filters: FeedingHistoryFilters;
  horses: { id: string; barn_name: string }[];
  planHorse?: string;
}) {
  return (
    <Form
      action="/admin/feeding#feeding-history"
      className="panel record-form stack"
      aria-label="Search feeding history"
    >
      {planHorse && <input name="horse" type="hidden" value={planHorse} />}
      <div className="form-grid">
        <label>
          Search history
          <FormInput
            name="history_q"
            type="text"
            enterKeyHint="search"
            maxLength={100}
            defaultValue={filters.query}
            placeholder="Horse, time or note"
          />
        </label>
        <label>
          Horse
          <AppSelect name="history_horse" defaultValue={filters.horse}>
            <option value="">All horses</option>
            {horses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.barn_name}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          From
          <TemporalInput
            type="date"
            name="history_from"
            defaultValue={filters.from}
          />
        </label>
        <label>
          Through
          <TemporalInput
            type="date"
            name="history_to"
            defaultValue={filters.to}
          />
        </label>
      </div>
      <p className="muted form-hint">
        Dates use the day the feeding was given, not when it was entered. Search
        horse names, saved feeding times or correction notes. Corrected records
        remain available under Corrections.
      </p>
      <div className="form-actions">
        <button type="submit" className="button primary">
          Apply filters
        </button>
        <ClearFeedingHistoryFilters
          href={feedingHistoryUrl(
            { from: "", to: "", horse: "", query: "" },
            undefined,
            planHorse,
          )}
        />
      </div>
    </Form>
  );
}
