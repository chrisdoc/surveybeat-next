import { Schema } from "effect";

export class EmailTaken extends Schema.TaggedError<EmailTaken, { readonly brand: unique symbol }>()(
  "EmailTaken",
  {},
  { httpApiStatus: 409 },
) {}

export class EmailUnusable extends Schema.TaggedError<EmailUnusable, { readonly brand: unique symbol }>()(
  "EmailUnusable",
  {},
  { httpApiStatus: 422 },
) {}

export class EmailUnchanged extends Schema.TaggedError<EmailUnchanged, { readonly brand: unique symbol }>()(
  "EmailUnchanged",
  {},
  { httpApiStatus: 422 },
) {}

export class EmailChangePending extends Schema.TaggedError<
  EmailChangePending,
  { readonly brand: unique symbol }
>()("EmailChangePending", {}, { httpApiStatus: 409 }) {}

export class WrongEmailCode extends Schema.TaggedError<WrongEmailCode, { readonly brand: unique symbol }>()(
  "WrongEmailCode",
  {},
  { httpApiStatus: 422 },
) {}

export class SignInAgainRequired extends Schema.TaggedError<
  SignInAgainRequired,
  { readonly brand: unique symbol }
>()("SignInAgainRequired", {}, { httpApiStatus: 403 }) {}

export class PersonHasAccount extends Schema.TaggedError<
  PersonHasAccount,
  { readonly brand: unique symbol }
>()("PersonHasAccount", {}, { httpApiStatus: 409 }) {}
