// @effect-diagnostics asyncFunction:off -- a standalone Node script: it reports to the shell and never builds an Effect program.
// @effect-diagnostics globalFetch:off -- the script calls the deployed stage over the platform fetch; there is no HttpClient outside a Worker.

/**
 * A small client for the Workers Observability query API (Workers Logs), used by the canary sweep.
 *
 *   POST /accounts/{account_id}/workers/observability/telemetry/query
 *
 * The account's Workers Logs are rate limited: `GET /accounts/{account_id}/observability/usage/limit`
 * reports `status: "limited"` and `sample_rate: 0.01`, a 1% head-based sample (docs/infra.md).
 * A single request then has a 99% chance of leaving no event, which is why the spike's few dozen
 * requests never showed up. The sweep therefore sends each canary many times.
 */
import * as Schema from "effect/Schema";

const api = "https://api.cloudflare.com/client/v4";

export interface Account {
  readonly accountId: string;
  readonly token: string;
}

export interface EventQuery {
  readonly from: number;
  readonly to: number;
  /** Only events of this Worker script (`$metadata.service`). */
  readonly service?: string;
  /** Free-text search across every field of an event, case-insensitive. */
  readonly needle?: string;
}

/** The request body for one events query. */
export const queryBody = (query: EventQuery) => ({
  queryId: "surveybeat-canary-sweep",
  timeframe: { from: query.from, to: query.to },
  view: "events",
  limit: 100,
  parameters: {
    ...(query.needle === undefined ? {} : { needle: { value: query.needle } }),
    filters:
      query.service === undefined
        ? []
        : [{ key: "$metadata.service", operation: "eq", type: "string", value: query.service }],
  },
});

const QueryResponse = Schema.Struct({
  result: Schema.Struct({
    events: Schema.optional(
      Schema.Struct({
        count: Schema.optional(Schema.Finite),
        events: Schema.optional(
          Schema.Array(
            Schema.Struct({ $metadata: Schema.Struct({ service: Schema.optional(Schema.String) }) }),
          ),
        ),
      }),
    ),
  }),
});

export interface EventCount {
  /** Events stored for the query. Sampled events are not scaled up. */
  readonly count: number;
  /** The Worker scripts the returned events came from. */
  readonly services: ReadonlyArray<string>;
}

export const decodeEventCount = (body: unknown): EventCount => {
  const events = Schema.decodeUnknownSync(QueryResponse)(body).result.events;
  const returned = events?.events ?? [];
  return {
    count: events?.count ?? returned.length,
    services: [...new Set(returned.flatMap((event) => event.$metadata.service ?? []))],
  };
};

export const countEvents = async (account: Account, query: EventQuery): Promise<EventCount> => {
  const response = await fetch(`${api}/accounts/${account.accountId}/workers/observability/telemetry/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" },
    body: JSON.stringify(queryBody(query)),
  });
  if (!response.ok) {
    throw new Error(`Observability query failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return decodeEventCount(await response.json());
};

/** The account's Workers Logs sampling state, for the failure message. Never throws. */
export const usageLimit = async (account: Account): Promise<string> => {
  try {
    const response = await fetch(`${api}/accounts/${account.accountId}/observability/usage/limit`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    return `HTTP ${response.status} ${await response.text()}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
