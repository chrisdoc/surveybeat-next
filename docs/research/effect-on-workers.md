# Effect HTTP API on Cloudflare Workers, Durable Objects, and Workflows

Research for issue #9 (map #1). Researched on 2026-11-07. Throwaway branch, never merged.

Question: how mature is running Effect, and the HttpApi module (declare the API once, derive the server and a typed client), on Workers, Durable Objects (DOs) and Workflows? SPEC §6.1 fixes Effect, Effect Schema and the HttpApi module. §6.3 requires the domain package to run in plain Node tests.

## Verdict

- **Target `effect@4.1.2`** (npm `latest`, published 2026-11-02). Pin every `@effect/*` package to the same version. Effect 4 shipped as 4.0.0 on 2026-10-01 and is an LTS line. Do not start on 3.x.
- **Workers run the HttpApi module.** `HttpRouter.toWebHandler` is the first-party adapter, and its own API docs carry Cloudflare-specific instructions. A real HttpApi Worker bundles to about 86 KiB gzip and starts in about 55–60 ms of local CPU, against a 1 s limit (my measurements below).
- **First-party coverage stops at HTTP and SQL.** Effect ships `@effect/sql-d1` and `@effect/sql-sqlite-do`. It ships nothing for DO classes, Workflow entrypoints, Queues or bindings. You either write a thin bridge yourself, or use Alchemy v2 (`alchemy@2.0.0-beta.85`), which is Effect-native and already covers Workers, DOs, Workflows, D1, KV and Queues. SPEC already fixes Alchemy as the infrastructure tool.
- **Maturity risk is real but bounded.** Every module involved (`effect/http`, `effect/http-api`, `effect/sql`, `effect/workflow`, `effect/schema/Model`, and all `@effect/sql-*` drivers) is tagged `@stability unstable`. That tag allows breaking changes in minor releases. Several Workers-specific bugs were fixed in Sept–Oct 2026, and one fix for request scopes is still open. Pin exact versions and read changelogs before you bump.

## 1. Effect version and what changed in v4

| Fact | Source |
| --- | --- |
| `effect` dist-tags: `latest: 4.1.2`, `prev: 3.22.4`. 4.0.0 published 2026-10-01, 4.1.0 on 2026-10-29, 4.1.2 on 2026-11-02 | `npm view effect dist-tags time` |
| "Effect 4.x is a long-term support (LTS) release, with at least three years of bug and security fixes." Bug fixes until Sept 2029 or one year after 5.0, whichever is later | `effect@4.1.2` README; https://effect.website/blog/releases/effect/40 |
| v4 development moved from `Effect-TS/effect-smol` (now archived, "Effect V4 Has Moved") into `Effect-TS/effect` `main`. v3 lives on the `v3` branch | https://github.com/Effect-TS/effect-smol README |
| Minimal program: 3.x 35.6 kB vs 4.x 7.1 kB (min+gzip). Throughput 6.4× higher, 86 % less memory per fiber | https://effect.website/blog/releases/effect/40 |
| Requires TypeScript ≥ 5.9 and `strict`. Node ≥ 22.19 when running on Node | `effect@4.1.2` README |

What changed for the platform packages (https://github.com/Effect-TS/effect/blob/main/MIGRATION.md):

- **`@effect/platform`, `@effect/rpc`, `@effect/cluster`, `@effect/sql` and others were merged into `effect`.** HTTP is now `effect/http` and HttpApi is now `effect/http-api`. SQL is `effect/sql`, workflows are `effect/workflow`, and so on. `@effect/platform` stays on its v3 line (`0.97.x`). Do not install it with v4.
- **Lockstep versioning.** Every remaining package (`@effect/platform-*`, `@effect/sql-*`, `@effect/ai-*`, `@effect/vitest`, `@effect/opentelemetry`) shares one version with `effect`.
- **Unstable module paths lost their `unstable` segment.** Use `effect/http`, not `effect/unstable/http`, and no compatibility exports remain. The modules are still `@stability unstable`, which means "new features in patch releases and breaking changes in minor releases". The migration guide also says "Moving these modules does not stabilize their APIs." The unstable list includes `http`, `http-api`, `rpc`, `schema` (sub-modules such as `Model`), `sql` and `workflow`. Every module in packages other than `effect` is unstable too.
- Core renames that affect every file: `Context.Tag` → `Context.Service`, `Schema.TaggedError` keeps its name, `catch*` combinators were renamed, and `Runtime<R>` was removed. The links are in MIGRATION.md.
- There is no `@effect/platform-cloudflare` and no `@effect/cloudflare` package (both 404 on npm). Workers use the platform-neutral `effect/http` directly.

## 2. Running HttpApi on Workers

### The adapter

v3's `HttpApp.toWebHandler` / `HttpApiBuilder.toWebHandler` became `HttpRouter.toWebHandler(appLayer, options)` in v4. It returns `{ handler, dispose }`, where `handler(request, context?)` returns a `Promise<Response>`. Its JSDoc in `effect@4.1.2` (`dist/http/HttpRouter.d.ts`) has a Cloudflare section:

> On Cloudflare Workers, build the handler at module scope: fibers started inside `fetch` capture that request's async context. Layer construction must not require request-time I/O; bindings are available from `cloudflare:workers` via its `env` export. … For shared fibers, provide a sync scheduler to both layers and requests …

The recommended shape, which I verified (see §4):

```ts
import { Context, Layer, Scheduler } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))
const App = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Handlers),
  Layer.provide(HttpServer.layerServices),
  Layer.provideMerge(SyncScheduler)
)
const { handler } = HttpRouter.toWebHandler(App, { disableLogger: true }) // module scope

export default {
  fetch: (req: Request, env: Env) => handler(req, Context.make(CfEnv, env))
}
```

The layer is built when `toWebHandler` is called, not inside the first request. This fixes v3 bug #6319, in which an aborted first request hung the isolate with error 1101 (closed 2026-10-21): https://github.com/Effect-TS/effect/issues/6319

### Typed client

The client comes from the same declaration: `HttpApiClient.make(Api, { baseUrl, transformClient })` over `FetchHttpClient.layer`. This is shown in `effect/ai-docs/src/51_http-server/10_basics.ts` inside the published package. Renames and schema changes are type-checked end to end. Keep the `Api` declaration in its own module (or package) so that server code stays out of the client bundle. The Effect docs say this explicitly in the same file.

### Providing bindings (env) as layers, per request

The `handler`'s second argument is a `Context.Context<ReqR>`. `ReqR` holds whatever services the handlers still require after the app layer is built. The type checker forces you to pass it when it is not `never`. So the clean way to provide Cloudflare bindings per request is:

1. Declare a `Context.Service` per binding, or one `CfEnv` service. Domain code depends on a domain interface (for example `RoundRepository`), never on `CfEnv`.
2. Leave those services unprovided in the app layer, and pass `Context.make(CfEnv, env)` (plus `ExecutionContext` if needed) on every call.

The alternative is `import { env } from "cloudflare:workers"` at module scope, which allows building the layers at module scope. Cloudflare permits reading `env` (vars, secrets, creating DO stubs) at global scope. It does not permit I/O there: no KV, no stub method calls, no fetch (https://developers.cloudflare.com/workers/runtime-apis/bindings/). Layers may capture binding handles but must not call them during construction.

### Workers-specific pitfalls (all from Effect-TS/effect issues)

| Issue | Status | Consequence for us |
| --- | --- | --- |
| [#9025](https://github.com/Effect-TS/effect/issues/9025) A long-lived fiber hangs once the request that scheduled its next turn has ended | Closed 2026-10-11 by documenting the limits ([PR #9033](https://github.com/Effect-TS/effect/pull/9033)). The runtime fix [#9032](https://github.com/Effect-TS/effect/pull/9032) was closed unmerged | Use `MixedScheduler("sync")`. Do not keep background fibers (forkScoped daemons, queue pollers) shared across requests. Put long work in Queues, Workflows or a DO alarm |
| [#8038](https://github.com/Effect-TS/effect/issues/8038) `Effect.fn` builds an `Error` per definition at module load, which cost up to 400 ms of startup CPU with 1,600 definitions in a large module | Fixed by [PR #8114](https://github.com/Effect-TS/effect/pull/8114) (2026-09-07): no capture when `Error.stackTraceLimit === 0` | Set `Error.stackTraceLimit = 0` at the top of the Worker entry if startup grows, which trades away definition-site stack frames. Prefer many small modules |
| [#9543](https://github.com/Effect-TS/effect/issues/9543) `FinalizationRegistry` in `HttpClient` throws "Disallowed operation called within global scope" | Closed 2026-10-19 | Fixed in 4.1.x. Shows that outbound `HttpClient` on workerd was only recently hardened |
| [#6006](https://github.com/Effect-TS/effect/issues/6006) / [#5987](https://github.com/Effect-TS/effect/issues/5987) `withTransaction` sent `BEGIN`/`COMMIT`, which DO SQLite forbids | Closed Oct 2026. The 4.1.2 driver now uses `storage.transaction()` | Transactions in DOs work on ≥ 4.1 (see §5) |
| [#10364](https://github.com/Effect-TS/effect/issues/10364) `HttpEffect.toHandled` cannot accept a caller-owned request scope, so work handed to `waitUntil` cannot keep request resources open | **Open** (opened by Alchemy maintainers) | Do not use request-scoped resources inside `ctx.waitUntil` work. Telemetry flushing needs care |

Other v4 notes: `McpServer.layerHttpRequestScoped` exists for serverless hosts (https://effect.website/docs/v4/api/effect/ai/McpServer). Older RPC msgpack used `new Function`, which Workers forbid. That was fixed by moving to msgpackr 1.11.10 (This Week in Effect, 2026-04-24: https://effect.website/blog/this-week-in-effect/2026/04/24/).

## 3. Durable Objects and Workflows

### Plain Effect (no Alchemy)

Effect has no DO or Workflow integration, so you write the bridge. It is small:

- **Durable Object.** In the constructor, build a `ManagedRuntime` (or a `toWebHandler`) from a layer that closes over `ctx.storage`, with `SqliteClient.layer({ storage: ctx.storage })` and the domain repositories. Run migrations inside `ctx.blockConcurrencyWhile(() => runtime.runPromise(SqliteMigrator.run(...)))`. Each RPC method or `fetch` calls `runtime.runPromise(program)`. The rules in §2 apply here too: build at construction, use the sync scheduler, and no fibers that outlive a request (alarms are the supported way to keep work going).
- **Workflow.** `class RoundWorkflow extends WorkflowEntrypoint { async run(event, step) { ... } }`. Each `step.do(name, () => runtime.runPromise(effect))` runs one idempotent Effect. Workflow durability (replay, retries, `step.sleep`) stays with Cloudflare. Effect supplies typed errors and services inside each step. Encode step results with Schema, because step outputs must be serializable.
- `effect/workflow` (Workflow, Activity, DurableClock, DurableDeferred) is an engine-agnostic durable workflow API. The core ships only an in-memory engine and the cluster engine. It has no Cloudflare engine (`effect@4.1.2` `dist/workflow/WorkflowEngine.d.ts`).

### Alchemy v2: Effect-native Cloudflare runtime

`alchemy@2.0.0-beta.85` and `@alchemy.run/cloudflare@2.0.0-beta.85` (2026-11-02) have a peer dependency on `effect ^4.1.0`. They define Workers, DOs and Workflows as Effect classes, with bindings resolved as Effect services (https://github.com/alchemy-run/alchemy, `packages/cloudflare/src/Workers`, `.../Workflows`):

- `Cloudflare.Worker<Api>()("Api", { main: import.meta.url }, Effect.gen(...))` returns `{ fetch: Effect }`. The init Effect pulls bindings (`yield* Cloudflare.D1.QueryDatabase(Db)`, `yield* Cloudflare.KV.ReadWriteNamespace(KV)`). The demo `demos/effect-prezzy/chapters/02-d1/src/Api.ts` serves an `HttpApiBuilder.layer(ShortyApi)` this way, through `HttpRouter.toHttpEffect`.
- `Cloudflare.DurableObject<Users>()("Users", Effect.gen(...))` returns typed RPC methods. Callers use `users.getByName(id).listUsers()` (`examples/cloudflare-durable-object-sql`). Migrations come from `Cloudflare.SqlMigrations`.
- `Cloudflare.Workflow<NotifyWorkflow>()("Notifier", ...)` with `Cloudflare.Workflows.task("name", effect, { retries, timeout, rollback })` wraps `step.do` and threads services into each step (`examples/cloudflare-worker/src/NotifyWorkflow.ts`). Alchemy also implements `effect/workflow`'s `WorkflowEngine` on native Workflows (`NativeEngine.ts`) and on Durable Objects (`DurableObjectEngine.ts`).
- Alchemy files Workers-runtime bugs upstream and fixes them, for example #10364 above and [alchemy#1639](https://github.com/alchemy-run/alchemy/pull/1639) (merged 2026-11-04).

Trade-off: Alchemy's runtime layer reduces the bridge code to almost nothing, and it matches the SPEC's choice of IaC tool. But it is beta (85 betas, a release every 1–2 weeks), so it couples app runtime code to the IaC tool's release cadence. The domain package stays clean either way, because it depends only on `effect`. Decide this in the architecture ticket. Keep adapters thin, so that moving between the plain bridge and Alchemy's runtime only touches the adapters package.

## 4. Bundle size and cold start (measured)

I measured this on 2026-11-07 with `effect@4.1.2`, `rolldown@1.2.13` (the bundler Alchemy uses), `esbuild@0.25.10` and `wrangler@4.158.0` on linux. The Worker serves an `HttpApi` with one group, three endpoints (GET list, GET by id with a typed 404 error, POST with a Schema payload) and an env-backed service, set up as in §2. The client calls `HttpApiClient.make(Api)` with `FetchHttpClient`. The scripts are in the scratchpad and are not committed. Rerun them by bundling the snippet in §2.

| Bundle | rolldown min | rolldown gzip | esbuild min | esbuild gzip |
| --- | --- | --- | --- | --- |
| Minimal `Effect.runPromise(Effect.succeed(1))` | 23.5 KB | 8.4 KB | 167 KB (barrel import) / 27 KB (`effect/Effect` import) | 58 KB / 9.9 KB |
| HttpApi Worker (server) | 275 KB | 87.5 KB | 521 KB | 169 KB |
| HttpApi typed client (browser) | 190 KB | 59.4 KB | 426 KB | 138 KB |

- **Bundler matters.** esbuild did not tree-shake `import { Effect } from "effect"` barrel namespaces, so its bundles came out 2–7× larger. Rolldown (Vite 8, Alchemy) matched the 7.1 kB headline. If anything uses esbuild, import from deep paths (`effect/Effect`).
- **Worker limits** are 64 MiB uncompressed with no compressed limit, and global scope must finish within 1 s (https://developers.cloudflare.com/workers/platform/limits/). An 87 KB-gzip Worker is far below both.
- **Startup.** `wrangler check startup` reported 53.9 / 58.4 / 61.0 ms active startup CPU across three runs for the HttpApi Worker, against 0–10 ms for a hello-world Worker. That is local workerd, and Cloudflare warns production CPUs differ. In Node 26: 37–43 ms module evaluation, about 45–50 ms for the first request (the layer was already built), and about 120–140 µs per warm request.
- **Verified behaviour** in the same run: 200 with JSON for list. 404 `{"_tag":"PulseNotFound","id":"2"}` for the typed error. 400 `HttpApiSchemaError` for a bad payload.
- **Answer page (SPEC §6.1):** the typed client costs about 59 KB gzip before any app code. For the small answer-page entry, either accept that or call the two or three answer endpoints with plain `fetch` plus the shared Schemas. Schema alone is far smaller than the HttpApi client. Measure this when the entry exists.

## 5. Effect Schema with SQLite (DO `sql` and D1)

- **`@effect/sql-sqlite-do@4.1.2`**: `SqliteClient.layer({ db?: SqlStorage, storage?: DurableObjectStorage })` provides `SqliteClient` and the generic `SqlClient`. Pass `storage` (not just `db`) to get transactions and migrations. "Transactions use `storage.transaction()` instead of transaction SQL." Nested transactions roll back on their own. Blobs come back as `Uint8Array`, and `updateValues` is unsupported. `SqliteMigrator.run/layer` records applied migrations in `effect_sql_migrations` and is meant to run "during construction" of the DO (package JSDoc, `dist/SqliteClient.d.ts`, `dist/SqliteMigrator.d.ts`).
- **`@effect/sql-d1@4.1.2`**: `D1Client.layer({ db: D1Database })`. It caches prepared statements and maps failures to `SqlError`. **No transactions, no streaming, no `updateValues`** (package JSDoc). That fits SPEC's small global index, but multi-row invariants need D1 `batch()` or a design that avoids them.
- **Schema ↔ SQL**: `effect/schema/Model` (`Model.Class` with `select`/`insert`/`update`/`json`/`jsonCreate`/`jsonUpdate` variants) plus `effect/sql` `SqlSchema` and `SqlModel` give one schema per domain type, shared by the API (`User.json` in the HttpApi fixtures) and the database. SPEC §6.1 asks for exactly this. All of it is `@stability unstable`.
- **DO SQLite limits to design around**: 100 bound parameters per query, 100 KB per statement, 2 MB per row, 100 columns, 10 GB per object on Workers Paid (https://developers.cloudflare.com/durable-objects/platform/limits/). Effect's own `SqlEventJournal` chunks at 100 parameters for this reason (`effect/src/eventlog/SqlEventJournal.ts`). Bulk inserts must chunk.
- **DO write-coalescing caveat**: Cloudflare commits writes with no intervening `await` atomically, and `sql.exec()` is synchronous (https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). Effect's async scheduler can put a macrotask between two statements, so use `withTransaction` explicitly for multi-statement invariants rather than relying on coalescing.

## 6. Testing with swapped layers in plain Node

- `@effect/vitest@4.1.2` provides `it.effect` and `layer(TestLayer)("suite", (it) => ...)`.
- `effect/http-api` `HttpApiTest.groups(Api, ["users"])` builds a typed client wired directly to the handlers, with no server and no network, "using the same request encoding, routing, and response decoding as a real server". The published example (`ai-docs/src/51_http-server/20_testing.ts`) swaps `Users.layerMemory` in for the SQL-backed layer and swaps auth middleware per test. This is exactly the plain-Node domain/API testing that SPEC §6.3 asks for.
- Because `toWebHandler` returns a plain `(Request) => Promise<Response>`, the same Worker entry can also be smoke-tested in Node with `new Request(...)`. I did this in §4.
- Adapter tests (DO SQLite, D1, Workflows) still need workerd: `@cloudflare/vitest-pool-workers` or Alchemy's local dev. `cloudflare:workers` `withEnv` overrides imported `env` in tests.

## 7. Examples in the wild

- **Alchemy v2** examples and demos (first-party, maintained, Effect 4): `examples/cloudflare-effect-sql-d1`, `examples/cloudflare-durable-object-sql`, `examples/cloudflare-worker` (Worker + DO + Workflow + Queue + KV), `examples/cloudflare-federated-api` (HttpApi), `demos/effect-prezzy` (HttpApi + D1 + Queues chapters). https://github.com/alchemy-run/alchemy/tree/main/examples
- **danieljvdm/effect-cf**: "Effect-native primitives for Cloudflare Workers and bindings", Effect ^4.1, 116 stars, active (pushed 2026-10-29). https://github.com/danieljvdm/effect-cf
- **gjermundgaraba/effect-actions PR #51**: Effect RPC served from Durable Objects over hibernating WebSockets. https://github.com/gjermundgaraba/effect-actions/pull/51
- **deracs/create-effect-project**: Effect v4 scaffolder with a Cloudflare Worker template for HTTP or RPC. https://github.com/deracs/create-effect-project
- **ksamirdev/effect-rpc-workers**: `@effect/rpc` on Workers. Last pushed 2025-12, before v4 shipped, so use it only for the pattern. https://github.com/ksamirdev/effect-rpc-workers
- Sandro Maglione, "Effect API on Cloudflare" (v3 `HttpApiBuilder.toWebHandler`, a secondary source). https://www.sandromaglione.com/newsletter/effect-api-on-cloudflare

## Recommendations for the build

1. Pin `effect`, `@effect/sql-sqlite-do`, `@effect/sql-d1`, `@effect/vitest` (and `@effect/ai-cloudflare` if used) to exactly `4.1.2`, and bump them together.
2. Build the HttpApi handler once at module scope with `MixedScheduler("sync")`. Pass `env`/`ctx` per request as a `Context`. Allow no shared background fibers.
3. Domain services depend on domain interfaces. Adapters provide them from `CfEnv`, DO `storage` or D1. Tests swap in memory layers and use `HttpApiTest`.
4. Decide in the architecture ticket whether to use Alchemy v2's Effect runtime (`Cloudflare.Worker/DurableObject/Workflow`) or a hand-written bridge of about 100 lines. Both work on 4.1.x.
5. Write a spike before committing: one org DO with `SqliteClient` + `withTransaction` + migrations, one Workflow with two `step.do` Effects, deployed to a preview stage. Measure deployed cold start there, since local CPU numbers do not carry over.
