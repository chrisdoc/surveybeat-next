import type { RoundResult } from "@surveybeat/domain";
import { message } from "../messages/locale.ts";

const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export const resultsSummary = (result: RoundResult): string | null => {
  if (result.status === "open" || result.delayed) return null;

  const checkedIn = message("results.summary.checkedIn", {
    count: result.submissionsCount,
    eligible: result.eligibleMembersCount,
  });
  if (!result.meetsMinimumGroupSize) {
    return `${checkedIn} ${message("results.summary.belowMinimum", { minimum: result.effectiveMinimumGroupSize })}`;
  }

  const shown = result.dimensions.filter((dimension) => dimension.meetsMinimumGroupSize);
  if (shown.length === 0) return checkedIn;
  const changes = shown.flatMap((dimension) => {
    const highlight = dimension.change?.highlight;
    if (highlight === null || highlight === undefined || !highlight.isLargerThanUsual) return [];
    const label = message(`dimension.${dimension.dimension}`);
    return highlight.direction === "rise"
      ? [message("results.summary.rise", { dimension: label })]
      : highlight.direction === "drop"
        ? [message("results.summary.drop", { dimension: label })]
        : [];
  });
  const judged = shown.filter((dimension) => dimension.typicalChange?.status === "ready");

  const second =
    changes.length > 0
      ? message(
          changes.length < judged.length ? "results.summary.changedRest" : "results.summary.changedAll",
          {
            changes: list.format(changes),
          },
        )
      : judged.length > 0
        ? message("results.summary.steady")
        : message("results.summary.baseline");

  return `${checkedIn} ${second}`;
};
