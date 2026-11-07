# Durable Objects (SQLite), Workflows and Cron Triggers: guarantees and limits

Research for issue #5 (map #1). Collected 2026-11-07 from developers.cloudflare.com. Each source lists the "Last updated" date the page showed on that day. Limits are for the **Workers Paid** plan unless the text says otherwise.

## Answer in brief

- **Storage is not the constraint.** A SQLite-backed Durable Object holds 10 GB. 5,000 People answering weekly for 5 years, with 7 Answers per Submission, measured at **0.64 GB with integer keys** and **3.15 GB with UUID text keys** (a 100% response rate, with invitations, participation records and three secondary indexes included). SPEC §6.2 calls this "well under" the limit. That holds with integer keys. With UUID keys the data uses about a third of the limit, which is comfortable but not "far away". See [Sizing check](#sizing-check).
- **Throughput per object is the real ceiling.** Plan for roughly 500 to 1,000 simple requests per second per object, single-threaded. An Organization-wide burst, such as 5,000 one-tap answers in a minute, is about 83 requests per second. That fits.
- **Insertion order is observable** through SQLite `rowid`. PITR also keeps every write for 30 days, deletes included. Both matter for the anonymity rule in SPEC §4 (see [Privacy implications](#privacy-implications-for-spec-4)).
- **Every scheduler involved here can run a step twice.** Alarms are at-least-once and can "fire more than once". Workflow steps are retried. Cron Triggers make no documented delivery promise. The idempotency requirement in SPEC §4 and §6.2 is therefore a platform requirement as well as a design goal.
- **A Workflow per Round fits the limits.** Sleeps last up to 365 days and do not count as steps. Instances that are waiting do not count against the concurrency limit. A Workflow reaches the Organization DO through `this.env` with an ordinary DO stub and RPC.

## Durable Objects with SQLite storage

### Limits

Source: [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (last updated Oct 29, 2026)

| Limit | Value |
| --- | --- |
| Storage per object | **10 GB** (Paid). The Free plan stops at 1 GB with a storage-full error. |
| Storage per account | Unlimited (Paid), 5 GB (Free) |
| Max row, string or BLOB | 2 MB |
| Max columns per table | 100 |
| Max SQL statement length | 100 KB |
| Max bound parameters per query | **100** (this caps multi-row `INSERT … VALUES` batches) |
| CPU per request | 30 s by default, configurable up to 5 min |
| Requests per second per object | soft limit of 1,000 |
| Alarm handler wall time | 15 min |
| Number of objects | unlimited |
| Classes per account | 500 (Paid) |

### Throughput

Source: [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) (last updated Nov 5, 2026)

- "A single Durable Object can handle approximately 500-1,000 requests per second for simple operations." The page gives about 500 to 750 for moderate processing and 200 to 500 for complex operations.
- Each object is "single-threaded". Input gates block new events while synchronous JavaScript runs. Output gates hold responses until pending writes are durable.
- Writes with no `await` between them are "automatically batched into a single atomic implicit transaction".
- The page's advice when load exceeds this is to shard across objects.

Implication: heavy analytics queries run on the same thread as answer intake. A long SQL scan during a send burst delays every answer for that Organization. This argues for the optional per-Round DO, or for precomputed Results, at large Organizations.

### Transactions

Source: [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) (last updated Sep 21, 2026)

- Each storage method is implicitly wrapped in a transaction. `transactionSync(cb)` rolls back when `cb` throws.
- `sql.exec()` cannot run `BEGIN TRANSACTION` or `SAVEPOINT`. Use `ctx.storage.transactionSync()` instead.
- The supported extensions include FTS5 (comment search), JSON and math functions. Writes to virtual tables count as rows written.
- `databaseSize` returns the current size in bytes, which supports a monitoring alarm well before 10 GB.
- KV-API data is stored in a hidden table `__cf_kv`. It appears in table listings but cannot be read through SQL.
- `deleteAll()` is atomic on SQLite. It deletes the alarm too for compatibility dates of 2026-02-24 or later.

### Alarms

Sources: [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/) (last updated Apr 21, 2026) and [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) (Nov 5, 2026)

- **One alarm per object.** A second `setAlarm()` overrides the first. The time is given in milliseconds since the epoch. No precision guarantee is documented.
- "Guaranteed at-least-once execution". A handler that throws is retried with exponential backoff from 2 s, up to 6 retries. `alarmInfo.retryCount` and `alarmInfo.isRetry` are exposed to the handler.
- Only one `alarm()` runs at a time per object. "In rare cases, alarms may fire more than once." Handlers must be idempotent.
- Alarms do not repeat. The handler must re-arm. Each `setAlarm()` is billed as one row written ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), Oct 18, 2026).
- With one alarm per object, an Organization DO that runs its own scheduling must multiplex: keep a schedule table and set the alarm to the earliest due row. Workflows avoid that work for the Round lifecycle.

### Point-in-time recovery and backups

Source: [SQLite storage API, PITR section](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) (Sep 21, 2026)

- PITR can restore the object "to any point in time in the past 30 days". It is not available in local development.
- `getCurrentBookmark()`, `getBookmarkForTime(t)` (t must be within 30 days), then `onNextSessionRestoreBookmark(b)` followed by `ctx.abort()`. The restore returns a bookmark for the state before the recovery, so the restore can be undone.
- Bookmarks are "lexically comparable": earlier points sort first.
- PITR restores the **whole object**. There is no per-table or per-row restore.
- **No managed export or backup to external storage is documented.** The [data security page](https://developers.cloudflare.com/durable-objects/reference/data-security/) (Apr 21, 2026) covers only encryption at rest (LUKS, keys managed by Cloudflare). Backups older than 30 days, and the R2 backups in SPEC §6.2, need application code: an alarm or Workflow that dumps tables to R2, paged to stay under the CPU limit per request.

### Are rowids and insertion order observable?

Cloudflare's docs do not mention `rowid` or `AUTOINCREMENT`. The storage is ordinary SQLite, so SQLite's own rules apply ([SQLite rowid tables](https://www.sqlite.org/rowidtable.html), [WITHOUT ROWID](https://www.sqlite.org/withoutrowid.html)):

- Every table without `WITHOUT ROWID` has a 64-bit `rowid`, readable with `SELECT rowid`. An `INTEGER PRIMARY KEY` column is an alias for it. New rows normally get `max(rowid)+1`, so the **rowid encodes insertion order** even when the declared primary key is random.
- A plain `SELECT` with no `ORDER BY` usually returns rowid order. Code and exports that omit `ORDER BY` leak insertion order.
- `WITHOUT ROWID` tables have no rowid. They store rows in primary-key order, so a random key (UUIDv4 or a random blob) makes the physical order independent of insertion time.
- PITR bookmarks give every write a position in the object's history (see the privacy section below).

## Workflows

### Limits

Source: [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) (last updated Nov 4, 2026) and [changelog, 2026-04-15](https://developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised/)

| Limit | Paid |
| --- | --- |
| Steps per Workflow | 10,000 by default, configurable up to 25,000. **`step.sleep` does not count.** |
| Step return value | 1 MiB |
| Persisted state per instance | 1 GB |
| Max `step.sleep` | 365 days |
| Concurrent running instances | 50,000 per account (raised from 10,000 on 2026-04-15). The prose on the limits page still says 10,000, which is stale. |
| Queued instances per Workflow | 2,000,000 |
| Instance creation rate | 300/s per account, 100/s per workflow |
| CPU per step | 30 s by default, configurable up to 5 min. Wall time per step is unlimited. |
| Subrequests per instance | 10,000, configurable up to 10M |
| Event payload | 1 MiB |
| Instance ID | 100 characters, unique per Workflow |
| Completed instance retention | 7 days by default, up to 30 days |
| `waitForEvent` default timeout | 24 h ([Workers API](https://developers.cloudflare.com/workflows/build/workers-api/), Nov 4, 2026) |

Waiting instances, which includes sleeping, retry backoff and `waitForEvent`, "do **not** count towards concurrency limits". A waiting instance that resumes while the account is at its concurrency limit is queued. Instances that resume from sleep take priority over newly queued instances ([Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/), Sep 24, 2026).

Fit for SurveyBeat: a Round needs roughly 10 to 100 steps (open, invitation batches, reminders, close, compute, notify), well under 10,000. Invitation batches have to respect the 1 MiB return value, so a step should return counts or IDs, not payloads. Return values are persisted Workflow state, so Answers and comments must never pass through them, because Workflow state is outside the Organization DO. One Round per Pulse per week across thousands of Organizations means mostly waiting instances, and those do not count toward concurrency.

### Retry and idempotency semantics

Sources: [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) (Oct 15, 2026), [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/) (Sep 24, 2026), [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/) (Nov 4, 2026)

- Default step config: `retries: { limit: 5, delay: 10000, backoff: "exponential" }`, `timeout: "10 minutes"`. Throwing `NonRetryableError` fails the instance immediately, after any rollback handlers run.
- "Because a step might be retried multiple times, your steps should (ideally) be idempotent." A step can partly succeed and then retry, for example after sending 300 of 500 emails. Make each send idempotent with a key held in the DO, such as `(round_id, person_id)` on the invitation row.
- Step results are persisted, and "step names act as the 'cache key'". Names must be deterministic. Code outside steps can run more than once, and in-memory state can be lost when the instance hibernates. Wrap `Date.now()`, randomness and side effects in steps.
- The `event` is immutable. Pass data between steps through return values.
- `create({ id })` **throws** if the ID exists and is still within its retention period. `createBatch` does not throw and reports the duplicate as error `10405`. A deterministic instance ID such as `round-<roundId>` therefore deduplicates creation, but only for 7 to 30 days after the instance completes. The DO must stay the source of truth for whether a Round exists.
- Restarting an instance from a given step reuses the cached results of all earlier steps.
- Status values: `queued`, `running`, `paused`, `errored`, `terminated`, `complete`, `waiting`, `waitingForPause`, `unknown`.

### How a Workflow talks to a Durable Object

- A `WorkflowEntrypoint` reads its bindings through `this.env` ([Workers API](https://developers.cloudflare.com/workflows/build/workers-api/); [Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)). With a DO namespace bound, a step calls `this.env.ORG.getByName(orgId).someMethod()` over RPC ([DO namespace](https://developers.cloudflare.com/durable-objects/api/namespace/)).
- The other direction: a DO holds a Workflow binding and calls `create()`, or `sendEvent()` to wake a `waitForEvent` (for example "lead closed the Round early"). The [durable agents guide](https://developers.cloudflare.com/workflows/get-started/durable-agents/) (Oct 27, 2026) shows this with the Agents SDK (`runWorkflow`, `AgentWorkflow`, `onWorkflowComplete`). Its callbacks to the Agent from a Workflow are labelled "non-durable".
- No Cloudflare page shows a raw `step.do(() => stub.method())` example. The pattern follows from the pieces above, but it is **not documented as such**. Run it in Miniflare before relying on it. RPC calls are not exactly-once: a step retry calls the DO method again, so DO methods called from steps must be idempotent.

## Cron Triggers

Sources: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (Oct 17, 2026), [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) (Oct 17, 2026), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (Oct 29, 2026)

- Five-field cron syntax with Quartz-style extensions (`L`, `W`, `#`). The resolution is **1 minute** (`* * * * *` means "at every minute"). All schedules run in **UTC**.
- 250 Cron Triggers per account (Paid). CPU time is 30 s for schedules under 1 hour and 15 min for schedules of 1 hour or more. Wall time is 15 min per invocation. Subrequests are capped at 10,000 per invocation.
- A schedule change can take up to 15 minutes to propagate.
- `controller.scheduledTime` gives the intended fire time. It works as a natural idempotency key, for example "create rounds due before `scheduledTime`".
- **Delivery guarantee: none documented.** The Cron Triggers and scheduled-handler pages state no at-least-once, at-most-once, retry or missed-run behaviour. The only first-party hint is the [Containers cron example](https://developers.cloudflare.com/containers/examples/cron/), which says it does not "guarantee exactly-once execution" and advises idempotent tasks. Design for zero, one or several runs per slot. The hourly "create next Round" job must therefore (a) be idempotent, for example with a unique `(pulse_id, scheduled_open_at)` in the DO, and (b) catch up: create every Round that is due, not only the one for this hour, so a missed tick heals on the next one.
- Local time zones: because cron is UTC-only, member-local send times belong in the Round's Workflow (`sleepUntil`), not in cron.

## Sizing check

Scenario: one Organization DO, 5,000 People, a weekly Round for 5 years, ~7 Answers per Submission, **100% response** (an upper bound).

- Rounds: 260. Invitations, participation records and Submissions: 1.3M each. Answers: **9.1M**.

Measured with local SQLite 3 (Python `sqlite3`, after `VACUUM`) at 1/10 scale, 500 People × 260 weeks, then multiplied by 10. The schema: `invitation` (with a unique 43-char token), `participation` (`WITHOUT ROWID`, PK `(round_id, person_id)`), `submission` (indexed on `round_id`), and `answer` (indexes on `submission_id` and `question_version_id`). One of the 7 Answers is a comment of 40 to 400 characters on 30% of Submissions. The script is in this session's scratchpad and can be reproduced from this description.

| Key style | 1/10 scale | Full scale | Share of 10 GB |
| --- | --- | --- | --- |
| `INTEGER PRIMARY KEY` | 64 MB | **0.64 GB** | ~6% |
| UUID text keys (36 chars) | 315 MB | **3.15 GB** | ~32% |

- Key choice changes the size by a factor of five. UUID text keys and foreign keys dominate. Integer keys, or 16-byte BLOB IDs, keep the 5-year footprint under 1 to 1.5 GB.
- Headroom remains with UUIDs, but extra indexes, an FTS5 index on comments, stored Results, audit logs, or Organizations above 5,000 People (such as 20,000 People weekly with UUIDs, about 12.6 GB) can reach the limit. Track `databaseSize` and set an alert threshold, for example 5 GB.
- Write billing over 5 years: each Answer costs about 3 rows written (row plus two indexes), which comes to roughly 30M rows. Spread over 60 months, that is far inside the 50M rows per month included ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): "every row update of an index counts as an additional row", per the [SQL API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)).
- Burst throughput: 5,000 Answers spread over minutes is tens of requests per second. One object handles that.

## Privacy implications for SPEC §4

The spec forbids joining participation records to Submissions in anonymous Rounds, "including indirect joins through timestamps, sequence numbers, insertion order".

1. **rowid.** If a participation record and a Submission are written in the same request, both rowids increase together. Matching by rank then re-identifies the member. Store anonymous Submissions and Answers in `WITHOUT ROWID` tables with random primary keys, never `INTEGER PRIMARY KEY` or `AUTOINCREMENT`. Never rely on default `SELECT` order. Alternatively, buffer anonymous Submissions and write them in a shuffled batch, which also helps against timing.
2. **Same-transaction writes.** Writing the participation record and the Submission in one implicit transaction is the natural way to reject a double submission, and it puts both writes at the same instant in the PITR log. The DO API exposes no per-row history, but anyone who can restore bookmarks can step through history write by write and correlate the two. Treat PITR as able to rebuild the join, and limit who can trigger a restore.
3. **PITR retention.** Data deleted or scrubbed stays recoverable through PITR for 30 days. That window must appear in the privacy notice and in the data-deletion SLA.
4. **Workflow state and logs.** Step return values and instance logs are kept for up to 30 days outside the DO. They must never contain Answers or anything that links a person to a Submission.

## Open points to verify in code

- Run `step.do(() => doStub.method())` from a Workflow in Miniflare and confirm the retry behaviour.
- Confirm that the Cloudflare SQLite build exposes `rowid` and accepts `WITHOUT ROWID`. Both are standard SQLite, but Cloudflare's docs do not say.
- Watch the Workflows limits page for the 10,000 versus 50,000 concurrency text being fixed.
