import { describe, expect, it } from "@effect/vitest";
import {
  type Identity,
  identityOf,
  normaliseEmail,
  OrganizationCreationAllowlist,
  PersonId,
  WorkosUserId,
} from "./Identity.ts";
import { OrganizationId } from "./Organization.ts";
import { candidatesFor, decideSignIn, type PersonCandidate } from "./SignIn.ts";

const identity = (emailVerified: boolean, email = "ada@example.com"): Identity =>
  identityOf(WorkosUserId.make("user_1"), email, emailVerified);

/** U+212A KELVIN SIGN: lower-cases (and NFKC-normalises) to an ASCII `k`. */
const KELVIN = "\u212a";

describe("email matching", () => {
  it("normalises case, whitespace, and compatibility forms", () => {
    expect(normaliseEmail(" Ada@Example.COM ")).toBe("ada@example.com");
    expect(normaliseEmail("\uff41da@example.com")).toBe("ada@example.com");
  });

  it("lets a non-ASCII address sign in but never match by email, even when verified", () => {
    const kelvin = identity(true, `${KELVIN}ate@example.com`);
    expect(kelvin.email).toBe("kate@example.com");
    expect(kelvin.emailMatchable).toBe(false);
    expect(candidatesFor(kelvin, [], [candidate("Acme", false)])).toEqual([]);
    expect(decideSignIn(kelvin, [], new OrganizationCreationAllowlist("kate@example.com"))._tag).toBe(
      "NotInOrganization",
    );
  });
});

const candidate = (organization: string, linked: boolean): PersonCandidate => ({
  organization: { id: OrganizationId.make(organization), name: organization },
  personId: PersonId.make(`${organization}-person`),
  linked,
});

const nobody = new OrganizationCreationAllowlist("");

describe("candidatesFor", () => {
  it("ignores email matches for an unverified email", () => {
    expect(candidatesFor(identity(false), [], [candidate("Acme", false)])).toEqual([]);
  });

  it("keeps linked Persons even when the email is unverified", () => {
    expect(candidatesFor(identity(false), [candidate("Acme", true)], [])).toEqual([candidate("Acme", true)]);
  });

  it("offers one Person per Organization, preferring the linked one, sorted by name", () => {
    expect(
      candidatesFor(
        identity(true),
        [candidate("Globex", true)],
        [candidate("Globex", false), candidate("Acme", false)],
      ),
    ).toEqual([candidate("Acme", false), candidate("Globex", true)]);
  });
});

describe("decideSignIn", () => {
  it("enters the only candidate", () => {
    expect(decideSignIn(identity(true), [candidate("Acme", false)], nobody)).toEqual({
      _tag: "Enter",
      candidate: candidate("Acme", false),
    });
  });

  it("asks to choose between several", () => {
    expect(
      decideSignIn(identity(true), [candidate("Acme", true), candidate("Globex", false)], nobody)._tag,
    ).toBe("ChooseOrganization");
  });

  it("offers creation only to a verified allowlisted email", () => {
    const allowlist = new OrganizationCreationAllowlist(" ADA@example.com ,, grace@example.com");
    expect(decideSignIn(identity(true), [], allowlist)._tag).toBe("CreateOrganization");
    expect(decideSignIn(identity(false), [], allowlist)._tag).toBe("NotInOrganization");
    expect(decideSignIn(identity(true, "eve@example.com"), [], allowlist)._tag).toBe("NotInOrganization");
    expect(decideSignIn(identity(true), [], nobody)._tag).toBe("NotInOrganization");
  });
});
