export const greeting = (h: { p: (attrs: unknown[], children: unknown[]) => unknown }, name: string) =>
  h.p([], [`Hello ${name}`]);
