import { Option, Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";

export const AuthUserId = Schema.String.pipe(Schema.brand("AuthUserId"));

export type AuthUserId = typeof AuthUserId.Type;

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));

export type SessionId = typeof SessionId.Type;

export const PersonId = Schema.String.pipe(Schema.brand("PersonId"));

export type PersonId = typeof PersonId.Type;

export const normaliseEmail = (email: string): string => email.normalize("NFKC").trim().toLowerCase();

const isPrintableAscii = (text: string): boolean => /^[\u0020-\u007E]*$/.test(text);

export const parseRectifiedEmail = (input: string): Option.Option<EmailAddress> => {
  const normalised = normaliseEmail(input);

  return isPrintableAscii(normalised) && Schema.is(EmailAddress)(normalised)
    ? Option.some(EmailAddress.make(normalised))
    : Option.none();
};

export interface Identity {
  readonly userId: AuthUserId;
  readonly email: EmailAddress;
  readonly emailVerified: boolean;

  readonly emailMatchable: boolean;
}

export const identityOf = (userId: AuthUserId, email: string, emailVerified: boolean): Identity => ({
  userId,
  email: EmailAddress.make(normaliseEmail(email)),
  emailVerified,
  emailMatchable: emailVerified && isPrintableAscii(email.trim()),
});

export class OrganizationCreationAllowlist {
  private readonly emails: ReadonlySet<string>;

  constructor(raw: string) {
    this.emails = new Set(
      raw
        .split(",")
        .map(normaliseEmail)
        .filter((email) => email.length > 0),
    );
  }

  allows(identity: Identity): boolean {
    return identity.emailMatchable && this.emails.has(normaliseEmail(identity.email));
  }
}
