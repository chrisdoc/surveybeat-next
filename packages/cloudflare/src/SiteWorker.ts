import * as Cloudflare from "@alchemy.run/cloudflare";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { hostnameFor, siteDomainFor } from "./Hostnames.ts";

/** `apps/web`'s landing-page build output (`vite.site.config.ts`). Absolute, like MainWorker's assets. */
const assetsDirectory = new URL("../../../apps/web/dist-site", import.meta.url).pathname;

/**
 * The Site Worker: the static landing page (English at `/`, German at `/de/`), prerendered at build
 * time and served from assets. Its one dynamic route, `/app`, redirects to the app's origin, so the
 * app Worker's routing and auth stay untouched (ADR 0020).
 */
export default class SiteWorker extends Cloudflare.Worker<SiteWorker>()(
  "Site",
  Effect.gen(function* () {
    const stack = yield* Stack;
    const domain = siteDomainFor(stack.stage);
    const appHostname = hostnameFor(stack.stage, "app");
    return {
      main: import.meta.url,
      assets: {
        directory: assetsDirectory,
        htmlHandling: "auto-trailing-slash",
        runWorkerFirst: ["/app", "/app/"],
      },
      // Stages without a custom app hostname live on workers.dev, whose URL is not known here: `/app` falls back to `/`.
      env: {
        ...(appHostname === undefined ? {} : { APP_ORIGIN: `https://${appHostname}` }),
      },
      ...(domain === undefined ? {} : { domain }),
    };
  }),
  Effect.gen(function* () {
    const appOrigin = yield* Config.String("APP_ORIGIN").pipe(Config.withDefault("/"));

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const path = request.url.split("?")[0];
        if (request.method === "GET" && (path === "/app" || path === "/app/")) {
          return HttpServerResponse.redirect(appOrigin, { status: 302 });
        }
        return HttpServerResponse.empty({ status: 404 });
      }),
    };
  }),
) {}
