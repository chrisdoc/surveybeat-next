export function scaleText(
  value: number,
  lowLabel: string | undefined,
  highLabel: string | undefined,
): string {
  const label = value === 1 ? lowLabel : value === 5 ? highLabel : undefined;

  return label === undefined || label === "" ? String(value) : `${value} · ${label}`;
}
