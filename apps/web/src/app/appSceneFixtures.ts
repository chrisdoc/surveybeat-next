import * as DateTime from "effect/DateTime";
import {
  ActionId,
  EmailAddress,
  MinimumGroupSize,
  OrganizationId,
  PersonId,
  PulseId,
  QuestionId,
  QuestionVersionId,
  RoundId,
  SendId,
  SendTime,
  TeamId,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import { Popover } from "@foldkit/ui";
import { Option, Schema } from "effect";
import * as Scene from "foldkit/scene";
import { fromString } from "foldkit/url";
import type { SessionModel } from "./session.ts";

export const instant = (iso: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(iso));

export const decodeOrgId = Schema.decodeSync(OrganizationId);

export const decodeTeamId = Schema.decodeSync(TeamId);

export const decodePulseId = Schema.decodeSync(PulseId);

export const decodePersonId = Schema.decodeSync(PersonId);

export const decodeQuestionId = Schema.decodeSync(QuestionId);

export const decodeVersionId = Schema.decodeSync(QuestionVersionId);

export const decodeTemplateKey = Schema.decodeSync(TemplateQuestionKey);

export const decodeTimeZone = Schema.decodeSync(TimeZone);

export const decodeEmail = Schema.decodeSync(EmailAddress);

export const decodeSize = Schema.decodeSync(MinimumGroupSize);

export const decodeSendTime = Schema.decodeSync(SendTime);

export const decodeRoundId = Schema.decodeSync(RoundId);

export const decodeActionId = Schema.decodeSync(ActionId);

export const decodeSendId = Schema.decodeSync(SendId);

export const makeUrl = (str: string) => Option.getOrThrow(fromString(str));

export const openAccountMenu = (organization: string, menu = "Account menu") => [
  Scene.click(Scene.role("button", { name: `${organization} ${menu}` })),
  Scene.Mount.resolve(Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()),
];

export const signedInAdmin = {
  _tag: "SignedIn",
  organization: { id: decodeOrgId("org-1"), name: "Acme" },
  organizationAdmin: true,
  locale: null,
  detectedLocale: null,
  organizationLocale: "en",
} satisfies SessionModel;
