import { Schema } from "effect";

export const DELIVERY_PAGE_PATH = "/delivery";
export const UNSUBSCRIBE_PAGE_PATH = "/api/reminders/unsubscribe";

export const pageRouteKeys = ["pages.delivery", "pages.unsubscribe"] as const;
export type PageRouteKey = (typeof pageRouteKeys)[number];

export const PageBody = Schema.Struct({
  token: Schema.optional(Schema.String),
  t: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String),
  lang: Schema.optional(Schema.String),
});
export type PageBody = typeof PageBody.Type;

export const decodePageBody = Schema.decodeUnknownOption(PageBody);
