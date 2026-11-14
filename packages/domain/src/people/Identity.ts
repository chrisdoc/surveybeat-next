import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";

export const WorkosUserId = Schema.String.pipe(Schema.brand("WorkosUserId"));
export type WorkosUserId = typeof WorkosUserId.Type;

export const WorkosOrganizationId = Schema.String.pipe(Schema.brand("WorkosOrganizationId"));
export type WorkosOrganizationId = typeof WorkosOrganizationId.Type;

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const PersonId = Schema.String.pipe(Schema.brand("PersonId"));
export type PersonId = typeof PersonId.Type;

export const normaliseEmail = (email: string): string => email.normalize("NFKC").trim().toLowerCase();

const isPrintableAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);

export interface Identity {
  readonly userId: WorkosUserId;
  readonly email: EmailAddress;
  readonly emailVerified: boolean;

  readonly emailMatchable: boolean;
}

export const identityOf = (userId: WorkosUserId, email: string, emailVerified: boolean): Identity => ({
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
