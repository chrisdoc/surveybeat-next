# The landing page is prerendered static HTML, served by its own Site Worker

The public marketing page for surveybeat.app is not part of the app. It is prerendered at build time from the web catalogs into `apps/web/dist-site`: English at `/`, German at `/de/`, with no JavaScript. The `apps/web` build runs `vite.site.config.ts` after the app build (`vite.config.ts`), so both outputs come from one package.

- **Serving.** A separate Site Worker (`packages/cloudflare/src/SiteWorker.ts`) serves those files from static assets. Its one dynamic route is `/app`, which redirects to the app's origin. The Main Worker's routing, auth, and cookies stay untouched, and so does the Submission Worker's privacy posture (ADR 0005).
- **Hostnames.** A PR stage serves the page on `pr-<n>.surveybeat.app`, and `staging` on `staging.surveybeat.app`. Production serves it on workers.dev until the apex cutover, because the apex and `www` still point at the old app on Vercel. The cutover steps are in `docs/infra.md`. Production then takes the apex, and `www` redirects to it.
- **Scope.** The page holds no personal data and no Submission, so it needs no privacy invariant of its own. Its copy lives in the web catalogs (ADR 0018).

## Considered Options

- **Serve the page from the Main Worker.** Rejected: the app's routing, auth, and queues would share a deploy with a marketing page, and `/` would move out of the app's control.
- **Client-rendered page in the app entry.** Rejected: the page must load fast and without JavaScript, the same reasoning as the answer entry (ADR 0008).

## Consequences

- There are now three Workers; AGENTS.md says so.
- Every Cloudflare resource for the page is declared in `infra/alchemy.run.ts`, as for the other Workers.
