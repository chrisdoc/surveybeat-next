import { describe, expect, it } from "@effect/vitest";
import { EmailAddress } from "../email/Email.ts";
import { EMPTY_PULSE_STATE } from "../pulses/Editor.ts";
import { offboardingAccess, offboardingConfirmation } from "./Directory.ts";
import type { DirectoryState, PersonRecord } from "./Directory.ts";
import { PersonId } from "./Identity.ts";
import { offboardingExportOf } from "./Offboarding.ts";
import { OrganizationId } from "./Organization.ts";
import { MembershipId, TeamId, TimeZone } from "./Team.ts";

const ADMIN = PersonId.make("admin");

const LEAD = PersonId.make("lead");

const NAME = "Acme Inc";

const person = (id: PersonId, email: string, organizationAdmin: boolean): PersonRecord => ({
  id,
  email: EmailAddress.make(email),
  authUserId: null,
  organizationAdmin,
  removedAt: null,
  erasedAt: null,
  locale: null,
  detectedLocale: null,
});

const team = TeamId.make("team");

const state: DirectoryState = {
  organizationName: NAME,
  minimumGroupSize: 5,
  aiProcessing: false,
  defaultLocale: "en",
  people: [person(ADMIN, "admin@example.com", true), person(LEAD, "lead@example.com", false)],
  teams: [{ id: team, name: "Platform", timeZone: TimeZone.make("Europe/Berlin") }],
  memberships: [
    {
      id: MembershipId.make("m1"),
      teamId: team,
      personId: LEAD,
      role: "lead",
      startedAt: 1000,
      endedAt: null,
    },
  ],
};

describe("offboarding permission and confirmation", () => {
  it("lets only an Organization admin offboard", () => {
    expect(offboardingAccess(state, ADMIN)).toEqual({ _tag: "Viewed", value: null });
    expect(offboardingAccess(state, LEAD)).toEqual({ _tag: "Rejected", rejection: { _tag: "Forbidden" } });
    expect(offboardingAccess(state, PersonId.make("stranger"))).toEqual({
      _tag: "Rejected",
      rejection: { _tag: "Forbidden" },
    });
  });

  it("needs the Organization name exactly", () => {
    expect(offboardingConfirmation(state, ADMIN, NAME)).toEqual({ _tag: "Viewed", value: null });

    for (const wrong of ["", "acme inc", " Acme Inc", "Acme Inc ", "Acme"]) {
      expect(offboardingConfirmation(state, ADMIN, wrong)).toEqual({
        _tag: "Rejected",
        rejection: { _tag: "ErasureNotConfirmed" },
      });
    }
  });

  it("asks a Lead for nothing before refusing", () => {
    expect(offboardingConfirmation(state, LEAD, NAME)).toEqual({
      _tag: "Rejected",
      rejection: { _tag: "Forbidden" },
    });
  });

  it("allows the sole Organization admin", () => {
    expect(state.people.filter((each) => each.organizationAdmin)).toHaveLength(1);
    expect(offboardingConfirmation(state, ADMIN, NAME)._tag).toBe("Viewed");
  });
});

describe("the offboarding export", () => {
  it("lists the roster, the Teams and the ended Memberships with ISO timestamps", () => {
    const exported = offboardingExportOf({
      organizationId: OrganizationId.make("acme"),
      state: {
        ...state,
        people: [
          ...state.people,
          {
            ...person(PersonId.make("gone"), "erased-gone@erased.invalid", false),
            removedAt: 5000,
            erasedAt: 5000,
          },
        ],
      },
      timeZones: new Map([[LEAD, "Europe/Berlin"]]),
      pulses: EMPTY_PULSE_STATE,
      now: 0,
    });

    expect(exported.exportedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(exported.people.map((each) => each.email)).toEqual([
      "admin@example.com",
      "lead@example.com",
      "erased-gone@erased.invalid",
    ]);
    expect(exported.people[1]?.timeZone).toBe("Europe/Berlin");
    expect(exported.people[2]).toMatchObject({
      removedAt: "1970-01-01T00:00:05.000Z",
      erasedAt: "1970-01-01T00:00:05.000Z",
    });
    expect(exported.memberships[0]).toMatchObject({ endedAt: null, startedAt: "1970-01-01T00:00:01.000Z" });
    expect(Object.keys(exported).sort()).toEqual([
      "exportedAt",
      "memberships",
      "organization",
      "people",
      "pulses",
      "schemaVersion",
      "teams",
    ]);
  });
});
