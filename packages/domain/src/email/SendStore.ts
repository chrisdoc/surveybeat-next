import { Context, Effect, Layer, Option, Ref, Semaphore } from "effect";
import type { EmailAddress, SendId, TransactionalEmail } from "./Email.ts";
import {
  abandon,
  claim,
  type DeliveryEventKind,
  pending,
  recordDeliveryEvent,
  type SendOutcome,
  type SendPolicy,
  type SendState,
  settle,
} from "./SendState.ts";

/** One transactional send: who gets what, and how far it got. */
export interface SendRecord {
  readonly id: SendId;
  readonly recipient: EmailAddress;
  readonly email: TransactionalEmail;
  readonly state: SendState;
}

/** What a delivery found when it claimed a send. */
export type ClaimResult =
  | {
      readonly _tag: "Send";
      readonly attempt: number;
      readonly recipient: EmailAddress;
      readonly email: TransactionalEmail;
    }
  | { readonly _tag: "Wait"; readonly until: number }
  | { readonly _tag: "Finished"; readonly state: SendState }
  | { readonly _tag: "Missing" };

/**
 * Where send states live, with every transition applied atomically. The Organization Durable
 * Object implements it for Invitations and any other transactional email (ADR 0006).
 * `now` is passed in so a transition does not depend on the store's clock.
 */
export interface SendStoreShape {
  /** Idempotent: creating a send that exists returns its current state and changes nothing. */
  readonly create: (
    id: SendId,
    recipient: EmailAddress,
    email: TransactionalEmail,
  ) => Effect.Effect<SendState>;
  readonly get: (id: SendId) => Effect.Effect<Option.Option<SendRecord>>;
  readonly claim: (id: SendId, now: number) => Effect.Effect<ClaimResult>;
  /** The state after the outcome, or the unchanged state when `attempt` no longer held the send. */
  readonly settle: (
    id: SendId,
    attempt: number,
    outcome: SendOutcome,
    now: number,
  ) => Effect.Effect<Option.Option<SendState>>;
  readonly abandon: (id: SendId, now: number) => Effect.Effect<Option.Option<SendState>>;
  readonly recordDeliveryEvent: (
    id: SendId,
    kind: DeliveryEventKind,
    code: string | null,
    now: number,
  ) => Effect.Effect<Option.Option<SendState>>;
}

export class SendStore extends Context.Service<SendStore, SendStoreShape>()("@surveybeat/domain/SendStore") {}

/** Rows only. `transaction` must make a read followed by writes atomic. */
export interface SendRepository {
  readonly get: (id: SendId) => Effect.Effect<Option.Option<SendRecord>>;
  /** Does nothing when the send exists. */
  readonly insert: (record: SendRecord) => Effect.Effect<void>;
  readonly setState: (id: SendId, state: SendState) => Effect.Effect<void>;
  readonly transaction: <A>(effect: Effect.Effect<A>) => Effect.Effect<A>;
}

/** The transitions of `SendState.ts` on top of any repository. */
export const makeSendStore = (repository: SendRepository, policy: SendPolicy): SendStoreShape => {
  const transition = (id: SendId, step: (state: SendState) => Option.Option<SendState>) =>
    repository.transaction(
      Effect.gen(function* () {
        const record = yield* repository.get(id);
        if (Option.isNone(record)) return Option.none<SendState>();
        const current = record.value.state;
        const next = step(current);
        if (Option.isSome(next)) yield* repository.setState(id, next.value);
        return Option.some(Option.getOrElse(next, () => current));
      }),
    );

  return {
    create: (id, recipient, email) =>
      repository.transaction(
        Effect.gen(function* () {
          const existing = yield* repository.get(id);
          if (Option.isSome(existing)) return existing.value.state;
          yield* repository.insert({ id, recipient, email, state: pending });
          return pending;
        }),
      ),

    get: repository.get,

    claim: (id, now) =>
      repository.transaction(
        Effect.gen(function* () {
          const record = yield* repository.get(id);
          if (Option.isNone(record)) return { _tag: "Missing" } as const;
          const decision = claim(record.value.state, now, policy);
          switch (decision._tag) {
            case "Send":
              yield* repository.setState(id, decision.state);
              return {
                _tag: "Send",
                attempt: decision.state.attempt,
                recipient: record.value.recipient,
                email: record.value.email,
              } as const;
            case "Wait":
              return decision;
            case "Finished":
              if (decision.changed) yield* repository.setState(id, decision.state);
              return { _tag: "Finished", state: decision.state } as const;
          }
        }),
      ),

    // A stale settle is not an error: the send keeps whatever its lease expiry decided.
    settle: (id, attempt, outcome, now) =>
      transition(id, (state) => settle(state, attempt, outcome, now, policy)),

    abandon: (id, now) => transition(id, (state) => abandon(state, now)),

    recordDeliveryEvent: (id, kind, code, now) =>
      transition(id, (state) => recordDeliveryEvent(state, kind, code, now)),
  };
};

/** An in-memory repository, for tests and for anything that needs no durability. */
export const makeMemorySendRepository = Effect.gen(function* () {
  const rows = yield* Ref.make(new Map<SendId, SendRecord>());
  const lock = yield* Semaphore.make(1);
  const repository: SendRepository = {
    get: (id) => Ref.get(rows).pipe(Effect.map((map) => Option.fromNullishOr(map.get(id)))),
    insert: (record) =>
      Ref.update(rows, (map) => (map.has(record.id) ? map : new Map(map).set(record.id, record))),
    setState: (id, state) =>
      Ref.update(rows, (map) => {
        const record = map.get(id);
        return record === undefined ? map : new Map(map).set(id, { ...record, state });
      }),
    transaction: Semaphore.withPermit(lock),
  };
  return repository;
});

export const layerMemory = (policy: SendPolicy): Layer.Layer<SendStore> =>
  Layer.effect(
    SendStore,
    makeMemorySendRepository.pipe(Effect.map((repository) => makeSendStore(repository, policy))),
  );
