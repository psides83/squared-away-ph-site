"use client";
import { AppSelect } from "@/components/app-select";

import { useState } from "react";
import { Field } from "@/components/ui";
import { serviceModes, serviceLabels } from "@/lib/billing-days";
export function StayServiceFields({
  feedMode = "unrecorded",
  feedCents,
  boardingMode = "unrecorded",
  boardingCents,
}: {
  feedMode?: string;
  feedCents?: number | null;
  boardingMode?: string;
  boardingCents?: number | null;
}) {
  const [feed, setFeed] = useState(feedMode);
  const [boarding, setBoarding] = useState(boardingMode);
  return (
    <>
      <label>
        Feed agreement
        <AppSelect
          name="feed_billing"
          value={feed}
          onChange={(e) => setFeed(e.target.value)}
        >
          {serviceModes.map((mode) => (
            <option value={mode} key={mode}>
              {serviceLabels[mode]}
            </option>
          ))}
        </AppSelect>
      </label>
      {feed === "separate_monthly" && (
        <Field
          name="feed_monthly_rate"
          label="Separate monthly feed rate ($)"
          type="number"
          min={0}
          max={1000000}
          step="0.01"
          required
          defaultValue={
            feedCents === null || feedCents === undefined
              ? ""
              : (feedCents / 100).toFixed(2)
          }
        />
      )}
      <label>
        Boarding agreement
        <AppSelect
          name="boarding_billing"
          value={boarding}
          onChange={(e) => setBoarding(e.target.value)}
        >
          {serviceModes.map((mode) => (
            <option value={mode} key={mode}>
              {serviceLabels[mode]}
            </option>
          ))}
        </AppSelect>
      </label>
      {boarding === "separate_monthly" && (
        <Field
          name="boarding_monthly_rate"
          label="Separate monthly boarding rate ($)"
          type="number"
          min={0}
          max={1000000}
          step="0.01"
          required
          defaultValue={
            boardingCents === null || boardingCents === undefined
              ? ""
              : (boardingCents / 100).toFixed(2)
          }
        />
      )}
    </>
  );
}
