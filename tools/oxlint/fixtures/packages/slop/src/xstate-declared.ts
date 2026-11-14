declare const Effect: { readonly void: unknown };
declare const setupEffect: (config: {
  readonly actions: { readonly audit: (args: unknown) => unknown };
  readonly actors: { readonly work: unknown };
}) => {
  readonly createMachine: (config: unknown) => unknown;
};
declare const enq: ((action: unknown, args: unknown) => void) & { readonly spawn: (logic: unknown) => void };
declare const args: {
  readonly actions: { readonly audit: unknown };
  readonly actors: { readonly work: unknown };
};

export const logic = setupEffect({
  actions: { audit: () => Effect.void },
  actors: { work: undefined },
}).createMachine({});

export const fire = (): void => {
  enq(args.actions.audit, args);
  enq.spawn(args.actors.work);
};
