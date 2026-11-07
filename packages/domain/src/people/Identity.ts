import { Schema } from "effect";
import { EmailAddress } from "../email/Email.ts";

/** A WorkOS user (`user_…`). One per human across every Organization. */
export const WorkosUserId = Schema.String.pipe(Schema.brand("WorkosUserId"));
export type WorkosUserId = typeof WorkosUserId.Type;

/** The WorkOS organization (`org_…`) an Organization maps to one to one (SPEC §4). */
export const WorkosOrganizationId = Schema.String.pipe(Schema.brand("WorkosOrganizationId"));
export type WorkosOrganizationId = typeof WorkosOrganizationId.Type;

/** A WorkOS session (`session_…`), the access token's `sid` claim. */
export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

/** A Person within one Organization. */
export const PersonId = Schema.String.pipe(Schema.brand("PersonId"));
export type PersonId = typeof PersonId.Type;

/**
 * Emails are compared case-insensitively everywhere: in the index, the allowlist, and linking.
 * Lower-casing the whole address (local part included) is what every mainstream provider does.
 * NFKC first, so compatibility forms of a character compare as one.
 */
export const normaliseEmail = (email: string): string => email.normalize("NFKC").trim().toLowerCase();

const isPrintableAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);

/** Who signed in, as the identity provider vouches for them. `email` is normalised. */
export interface Identity {
  readonly userId: WorkosUserId;
  readonly email: EmailAddress;
  readonly emailVerified: boolean;
  /**
   * Only a verified, printable-ASCII email (as the provider sent it) may link to a Person or open the
   * "Create an Organization" path (ADR 0002). A non-ASCII address can sign in but never matches:
   * normalising it (U+212A KELVIN SIGN lower-cases to `k`) could make a different mailbox equal.
   */
  readonly emailMatchable: boolean;
}

/** The identity for the address the provider sent, normalised. */
export const identityOf = (userId: WorkosUserId, email: string, emailVerified: boolean): Identity => ({
  userId,
  email: EmailAddress.make(normaliseEmail(email)),
  emailVerified,
  emailMatchable: emailVerified && isPrintableAscii(email.trim()),
});

/**
 * The operator allowlist for creating an Organization (ADR 0002): comma-separated emails,
 * configured per stage as the `ORG_CREATION_ALLOWLIST` secret. Never hard-coded.
 */
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

  /** An unverified or non-ASCII email is never allowlisted, whatever it says. */
  allows(identity: Identity): boolean {
    return identity.emailMatchable && this.emails.has(normaliseEmail(identity.email));
  }
}
