/**
 * The text of one point on a Rating's scale. Points 1 and 5 carry the Question's own labels; points 2 to 4 are
 * plain numbers, and so is an end whose label is missing or empty. Labels are set as textContent by the caller.
 */
export function scaleText(
  value: number,
  lowLabel: string | undefined,
  highLabel: string | undefined,
): string {
  const label = value === 1 ? lowLabel : value === 5 ? highLabel : undefined;
  return label === undefined || label === "" ? String(value) : `${value} · ${label}`;
}
