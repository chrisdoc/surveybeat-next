# `packages/cloudflare` depends on `packages/emails`

Amends the dependency table in ADR 0008, which listed `domain`, `api`, and the Alchemy runtime for `packages/cloudflare`. The Email Queue consumer (R1 05, PR #53) renders the React Email templates before handing the message to `EmailSender`, so `packages/cloudflare` also depends on `packages/emails`.

`packages/emails` still depends only on `domain`, and the React dependency stays confined to it. `domain` and `api` do not depend on `emails`.
