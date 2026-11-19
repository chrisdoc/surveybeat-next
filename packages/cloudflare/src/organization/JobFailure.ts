import * as Cause from "effect/Cause";

interface Tagged {
  readonly _tag?: unknown;
  readonly cause?: unknown;
}

const isObject = (value: unknown): value is Tagged => typeof value === "object" && value !== null;

const tagOf = (value: unknown): string => {
  if (isObject(value) && typeof value._tag === "string") {
    return value._tag;
  }

  return value instanceof Error ? value.name : typeof value;
};

const describeError = (value: unknown): string => {
  const tag = tagOf(value);

  if (tag !== "SqlError" || !isObject(value)) {
    return tag;
  }

  const driverError = isObject(value.cause) ? value.cause.cause : undefined;

  return driverError instanceof Error ? `${tag}: ${driverError.message}` : tag;
};

export const failureSummary = (cause: Cause.Cause<unknown>): string => {
  const parts = cause.reasons.map((reason) => {
    if (Cause.isFailReason(reason)) {
      return describeError(reason.error);
    }

    if (Cause.isDieReason(reason)) {
      return `Die(${describeError(reason.defect)})`;
    }

    return "Interrupt";
  });

  return parts.length === 0 ? "Empty" : parts.join(", ");
};
