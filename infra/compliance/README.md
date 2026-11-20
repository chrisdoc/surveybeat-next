# SurveyBeat Cloudflare Compliance (Steampipe + Powerpipe)

This Powerpipe mod audits SurveyBeat's Cloudflare infrastructure using the Steampipe [`turbot/cloudflare`](https://hub.steampipe.io/plugins/turbot/cloudflare) plugin against **GDPR** (Articles 5, 25, 32, 33) and **SOC 2** Trust Services Criteria (CC6, CC7, CC8, A1).

## Prerequisites

1. Install Steampipe, Powerpipe, and the `cloudflare` plugin:
   ```sh
   sudo /bin/sh -c "$(curl -fsSL https://steampipe.io/install/steampipe.sh)"
   sudo /bin/sh -c "$(curl -fsSL https://powerpipe.io/install/powerpipe.sh)"
   steampipe plugin install cloudflare
   ```
2. Configure a **read-only** Cloudflare API token (`CLOUDFLARE_API_TOKEN`) with:
   - Account: `Account Settings:Read`, `Access: Organizations, Identity Providers, and Groups:Read`, `Notifications:Read`, `Workers Scripts:Read`, `R2 Storage:Read`, `Logs:Read`
   - Zone (`surveybeat.app`): `Zone:Read`, `Zone Settings:Read`, `DNS:Read`, `Firewall Services:Read`, `Logs:Read`
   - User: `User Details:Read`, `API Tokens:Read`, `Audit Logs:Read`
3. Start Steampipe with `CLOUDFLARE_API_TOKEN` in the environment (or set `token` in `~/.steampipe/config/cloudflare.spc`):
   ```sh
   steampipe service restart
   ```

## Running benchmarks

```sh
# All GDPR + SOC 2 controls
powerpipe benchmark run --mod-location infra/compliance all_compliance

# GDPR only
powerpipe benchmark run --mod-location infra/compliance gdpr

# SOC 2 only
powerpipe benchmark run --mod-location infra/compliance soc2

# Or via the repo wrapper (also runs Workers observability check when --stage is passed)
pnpm check:compliance
pnpm check:compliance -- --stage production

# Audit every zone in the Cloudflare account instead of only surveybeat.app
powerpipe benchmark run --mod-location infra/compliance --var 'target_zones=["*"]' all_compliance
```

## Coverage boundary (`turbot/cloudflare` vs SurveyBeat scripts)

`turbot/steampipe-plugin-cloudflare` covers account/user IAM, API tokens, zones, zone settings, DNS, WAF rulesets, Worker scripts/routes, Logpush jobs, notification policies, and Access policies (and R2 buckets when S3 `access_key`/`secret_key` are configured in `~/.steampipe/config/cloudflare.spc`).

It does **not** currently expose tables for Workers Observability (`observability.logs` / `traces` / `invocation_logs`), D1, Durable Objects, Queues, AI Gateway, or Email Sending. Those privacy invariants remain enforced by:
- `pnpm check:observability --stage <stage>` (`infra/scripts/check-observability.ts`)
- `pnpm test:preview-privacy --stage <stage>` (`infra/tests/privacy/canary-sweep.ts`)
- `pnpm test:privacy` (`*.privacy.test.ts` across packages)
