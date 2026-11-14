import * as Cloudflare from "@alchemy.run/cloudflare";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { hostnameFor, siteDomainFor } from "./Hostnames.ts";

export const siteAssetsDirectory = new URL("../../../apps/web/dist-site", import.meta.url).pathname;

export const isAppRedirect = (method: string | undefined, path: string | undefined) =>
  method === "GET" && (path === "/app" || path === "/app/");

export default class SiteWorker extends Cloudflare.Worker<SiteWorker>()(
  "Site",
  Effect.gen(function* () {
    const stack = yield* Stack;
    const domain = siteDomainFor(stack.stage);
    const appHostname = hostnameFor(stack.stage, "app");
    return {
      main: import.meta.url,
      assets: {
        directory: siteAssetsDirectory,
        htmlHandling: "auto-trailing-slash",
        runWorkerFirst: ["/app", "/app/"],
      },
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
        if (isAppRedirect(request.method, path)) {
          return HttpServerResponse.redirect(appOrigin, { status: 302 });
        }
        return HttpServerResponse.empty({ status: 404 });
      }),
    };
  }),
) {}
