export const greeting = (
  h: { p: (attrs: unknown[], children: unknown[]) => unknown; AriaLabel: (val: string) => unknown },
  props: { text: string },
) => h.p([h.AriaLabel(props.text)], [props.text]);
