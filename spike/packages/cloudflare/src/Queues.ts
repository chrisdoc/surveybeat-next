import * as Cloudflare from "@alchemy.run/cloudflare";

export const Jobs = Cloudflare.Queues.Queue("Jobs");
export const JobsDlq = Cloudflare.Queues.Queue("JobsDlq");

export interface JobMessage {
  readonly id: string;
  /** When true the consumer fails on purpose so the message ends up in the DLQ. */
  readonly fail: boolean;
}
