import {
  EmailAddress,
  MinimumGroupSize,
  OrganizationId,
  PersonId,
  PulseId,
  QuestionId,
  QuestionVersionId,
  SendTime,
  TeamId,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import { fromString } from "foldkit/url";

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

export const makeUrl = (str: string) => Option.getOrThrow(fromString(str));
