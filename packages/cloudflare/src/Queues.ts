import * as Cloudflare from "@alchemy.run/cloudflare";

export const Jobs = Cloudflare.Queues.Queue("Jobs");
/** Cloudflare neither drains nor alerts on a dead-letter queue, so it has its own consumer. */
export const JobsDlq = Cloudflare.Queues.Queue("JobsDlq");

export interface JobMessage {
  readonly id: string;
}
