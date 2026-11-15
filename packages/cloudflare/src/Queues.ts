import * as Cloudflare from "@alchemy.run/cloudflare";

export const Jobs = Cloudflare.Queues.Queue("Jobs");
export const JobsDlq = Cloudflare.Queues.Queue("JobsDlq");

export interface JobMessage {
  readonly id: string;
}
