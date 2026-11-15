declare const enq: ((action: () => unknown) => void) & { readonly spawn: (logic: unknown) => void };
declare const Effect: { readonly succeed: (value: number) => unknown };
declare const createEffectLogic: (effect: unknown) => unknown;

export const fire = (): void => {
  enq(() => Effect.succeed(1));
  enq.spawn(createEffectLogic(Effect.succeed(2)));
};
