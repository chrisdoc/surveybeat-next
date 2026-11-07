# The Organization Durable Object owns each Round's state and schedule, and Release 1 uses no Workflows

SPEC §6.2 suggests a Workflow per Round plus an hourly Cron job that creates Rounds. Instead, each Round's state, together with a schedule table of its due jobs (open, send for a time zone, remind, close, compute, notify, create the next Round), lives in the Organization's Durable Object. One DO alarm is always set to the earliest due job, and the alarm handler runs each job as an idempotent DO method in the same transaction as the state change it makes. A daily Cron job only wakes every Organization's DO to repair a missing alarm.

This keeps one owner and one store for each Round. With Workflows, step results would be persisted outside the DO, a Workflow-to-DO bridge would have to be built for Effect, and every transition would span two systems that can each run a step twice. The cost is a small scheduling loop of our own on top of the alarm's at-least-once retries.

## Consequences

- A local time becomes UTC when its job is scheduled, using IANA time zones. Send times are restricted to 06:00–21:00 local.
- Exactly-once sending is enforced on the Invitation row (`pending → sending → sent | failed(reason)`, with a lease). A lease that expires with no outcome becomes `failed: unknown` and is shown to the Lead with Resend, never resent automatically. So a crash can cause a visible gap but never a duplicate.
- Workflows remain an option for later long-running jobs, such as AI theme generation in Release 2, if a DO alarm is a poor fit.
