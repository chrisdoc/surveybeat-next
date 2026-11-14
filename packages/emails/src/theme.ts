/**
 * Email palette. Light values are inline so clients without media queries show them; the dark values
 * live in `darkColors` and are applied through the `sb-*` classes in `Layout.tsx`. The light values
 * must match the app theme (a drift test compares them).
 */
export const colors = {
  page: "#F3F4F1",
  card: "#FFFFFF",
  border: "#E1E5E1",
  rowBorder: "#ECEFEC",
  text: "#0E2A24",
  muted: "#3D554F",
  accent: "#0B5D55",
  button: "#0E2A24",
  buttonText: "#FFFFFF",
  panel: "#0E2A24",
  panelText: "#DCE9E5",
  mint: "#9FD6CB",
  ratingBorder: "#768C85",
} as const;

export const darkColors = {
  page: "#0B1F1B",
  card: "#12302A",
  border: "#1E4038",
  rowBorder: "#1E4038",
  text: "#E8F0ED",
  muted: "#A9C2BA",
  button: "#9FD6CB",
  buttonText: "#0B2621",
  link: "#9FD6CB",
  panel: "#081814",
  panelText: "#DCE9E5",
  ratingBorder: "#6B8C83",
  ratingText: "#E8F0ED",
} as const;

/** No web font is loaded: Figtree is used only where the client has it. */
export const fonts = {
  sans: "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  display: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
} as const;

export const radius = {
  card: "20px",
  button: "12px",
} as const;
