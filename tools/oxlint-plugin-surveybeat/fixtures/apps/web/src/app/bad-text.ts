export const greeting = (h: {
  p: (attrs: unknown[], children: unknown[]) => unknown;
  Title: (val: string) => unknown;
}) => h.p([h.Title("Hello there")], ["Hello world"]);
