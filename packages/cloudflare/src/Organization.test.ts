// @effect-diagnostics cryptoRandomUUIDInEffect:off -- the fixture needs a value, not a secure token.
// @effect-diagnostics globalFetchInEffect:off -- the test drives the Worker with the platform fetch; an HttpClient belongs to the Worker, not to the test.

import "./auth/localTestSecrets.ts";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import * as Alchemy from "alchemy";
import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import MainWorker from "./MainWorker.ts";

// The adapter on local workerd (`dev: true`): the real Main Worker and Organization Durable Object.
const { test, beforeAll, deploy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});

const Stack = Alchemy.Stack(
  "SurveybeatOrganizationTest",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const main = yield* MainWorker;
    return { url: main.url.as<string>() };
  }),
);

const stack = beforeAll(deploy(Stack), { timeout: 240_000 });

test(
  "keeps the creator active, links People added by email at sign-in, and denies a removed one",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/people?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body: unknown = yield* Effect.promise(() => response.json());
    const none = { _id: "Option", _tag: "None" };
    const some = (value: unknown) => ({ _id: "Option", _tag: "Some", value });
    const eve = `added-1-${run}`;
    const ada = `added-2-${run}`;
    const acme = { id: `people-${run}`, name: "Acme" };
    assert.deepStrictEqual(body, {
      adminActive: some({
        personId: `admin-${run}`,
        organizationAdmin: true,
        locale: null,
        detectedLocale: null,
        organizationLocale: "en",
      }),
      eveActiveBeforeAdded: none,
      relinkSameUser: true,
      takeOverByOtherUser: false,
      linkMissingPerson: false,
      // Added by email: the D1 index offers the Person to that email until it is linked.
      unlinked: [{ organization: acme, personId: eve, linked: false }],
      eveSignIn: {
        _tag: "SignedIn",
        organization: acme,
        personId: eve,
        organizationAdmin: false,
        locale: null,
        detectedLocale: null,
        organizationLocale: "en",
      },
      adaSignIn: {
        _tag: "SignedIn",
        organization: acme,
        personId: ada,
        organizationAdmin: false,
        locale: null,
        detectedLocale: null,
        organizationLocale: "en",
      },
      linked: {
        eveActive: some({
          personId: eve,
          organizationAdmin: false,
          locale: null,
          detectedLocale: null,
          organizationLocale: "en",
        }),
        eveIndexed: [{ organization: acme, personId: eve, linked: true }],
        eveUnlinkedAfter: [],
      },
      removed: { adaActive: none, adaIndexed: [], adaSignInAgain: { _tag: "NotInOrganization" } },
      // Ada's Membership ended with her removal; Eve, the Lead, stays.
      roster: [{ personId: eve, email: "eve@example.com", role: "lead" }],
      // WorkOS memberships only once each signs in, and Ada's deactivated on removal (ADR 0010).
      workosCalls: [
        `ensure user_eve_${run} member`,
        `ensure user_ada_${run} member`,
        `deactivate user_ada_${run}`,
      ],
      queued: [`added-membership-1-${run}`, `added-membership-2-${run}`],
    });
  }),
);

test(
  "reads its sign-in bindings: a request without a session is unauthenticated, and login goes to AuthKit",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const session = yield* Effect.promise(() => fetch(`${url}/auth/session`));
    assert.strictEqual(session.status, 401);
    const login = yield* Effect.promise(() => fetch(`${url}/auth/login`, { redirect: "manual" }));
    assert.strictEqual(login.status, 302);
    const location = new URL(login.headers.get("location") ?? "");
    assert.strictEqual(location.searchParams.get("client_id"), "client_local_adapter_tests");
    assert.strictEqual(location.searchParams.get("redirect_uri"), `${url}/auth/callback`);
  }),
);

test(
  "stores the question library and Pulses: create from the Template, edit, and read back in order",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/pulses?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      results: unknown;
      view: { _tag: string; value: Record<string, unknown> & { questions: Array<Record<string, unknown>> } };
      list: unknown;
      first: string;
      rest: Array<string>;
    };
    assert.deepStrictEqual(body.results, {
      created: "Accepted",
      createdAgain: "Accepted",
      removed: "Accepted",
      reordered: "Accepted",
      addedBack: "Accepted",
      addedWritten: "Accepted",
      edited: "Accepted",
      settings: "Accepted",
      reorderMismatch: "OrderMismatch",
    });
    const pulseId = `pulse-${run}`;
    const { view } = body;
    assert.strictEqual(view._tag, "Viewed");
    assert.deepStrictEqual(view.value["settings"], {
      name: "Friday check-in",
      cadence: { _tag: "Weekly", day: "friday", time: "15:30" },
      answerWindowDays: 6,
      reviewWindowDays: 5,
      reminders: 0,
      anonymityMode: "anonymous",
      distribution: "invitation",
    });
    const written = `written-${run}`;
    assert.deepStrictEqual(
      view.value.questions.map((question) => question["questionId"]),
      [...[...body.rest].reverse(), `again-${run}`, written],
    );
    assert.strictEqual(body.first, `${pulseId}.workload-manageable`);
    assert.deepStrictEqual(view.value.questions.at(-2)?.["templateKey"], "workload-manageable");
    // The edit rewrote the written Question's first and only version.
    assert.deepStrictEqual(view.value.questions.at(-1), {
      questionId: written,
      versionId: `${written}.1`,
      templateKey: null,
      text: "How was the offsite?",
      dimension: "recognition",
      type: { _tag: "Rating", lowLabel: "Poor", highLabel: "Great", comment: true },
      hasAnswers: false,
      estimatedSeconds: 6,
    });
    assert.deepStrictEqual(view.value["warnings"], [
      { _tag: "NoOneTap" },
      { _tag: "TeamBelowMinimumGroupSize", members: 1, minimumGroupSize: 4 },
    ]);
    const list = body.list as {
      _tag: string;
      value: {
        team: Record<string, unknown>;
        pulses: ReadonlyArray<Record<string, unknown> & { nextRoundDate?: string | null }>;
      };
    };
    assert.strictEqual(list._tag, "Viewed");
    if (list._tag !== "Viewed") return;
    // The list names each Pulse's state and next Round; the date comes from its scheduled Round.
    const { nextRoundDate, ...pulse } = list.value.pulses[0]!;
    assert.match(nextRoundDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.deepStrictEqual(
      { team: list.value.team, pulses: [pulse] },
      {
        team: { id: `team-${run}`, name: "Platform", timeZone: "Europe/Berlin", yourRole: null },
        pulses: [
          {
            id: pulseId,
            name: "Friday check-in",
            cadence: { _tag: "Weekly", day: "friday", time: "15:30" },
            questionCount: 7,
            estimatedSeconds: 70,
            paused: false,
          },
        ],
      },
    );
  }),
);

test(
  "sends a test of a Pulse to its sender only, at most five an hour, and indexes its token apart from Invitations",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/test-invitations?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      burst: Array<string>;
      afterAnHour: string;
      member: string;
      sentAt: number;
      record: { tokenHash: string; pulseId: string; sentAt: number } | null;
      invitation: unknown;
      indexed: Array<{ organization_id: string; pulse_id: string; expires_at: number }>;
      asInvitation: Array<unknown>;
      captured: Array<{ recipient: string; subject: string }>;
    };
    // Six sends in the same hour: the sixth is refused. An hour later the window has moved on.
    assert.deepStrictEqual(body.burst, [
      "Accepted",
      "Accepted",
      "Accepted",
      "Accepted",
      "Accepted",
      "TestSendLimitReached",
    ]);
    assert.strictEqual(body.afterAnHour, "Accepted");
    // A plain member may not send a test of a Pulse they cannot edit.
    assert.strictEqual(body.member, "Forbidden");
    // Only the token's hash is kept, and the test is never an Invitation: no Round, no invitation_index row.
    assert.match(body.record?.tokenHash ?? "", /^[0-9a-f]{64}$/);
    assert.strictEqual(body.record?.pulseId, `pulse-${run}`);
    assert.strictEqual(body.record?.sentAt, body.sentAt);
    assert.strictEqual(body.invitation, null);
    assert.deepStrictEqual(body.asInvitation, []);
    assert.deepStrictEqual(body.indexed, [
      {
        organization_id: `test-invitations-${run}`,
        pulse_id: `pulse-${run}`,
        expires_at: body.sentAt + 7 * 24 * 60 * 60 * 1000,
      },
    ]);
    // The email goes to the sender's own address, marked as a test in its subject.
    assert.deepStrictEqual(body.captured, [
      { recipient: "admin@example.com", subject: "Test: Weekly team health" },
    ]);
  }),
);

test(
  "answers a test Invitation from its Pulse with no Round, and shows the Lead a redacted comment (ADR 0021)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/test-invitations?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      expiresAt: number;
      testContext: {
        roundId: string;
        pulseName: string;
        minimumGroupSize: number;
        questions: Array<{ id: string; position: number; text: string; type: unknown }>;
        actions: Array<unknown>;
        closeTime: number;
        state: string;
        hasAnswered: boolean;
        test?: boolean;
      } | null;
      view: { _tag: string; value: { questions: Array<{ versionId: string; text: string; type: unknown }> } };
      preview: { shownToLead: string | null };
      noComment: { shownToLead: string | null };
    };
    // The context is the Pulse's own: no Round, nothing answered, closing when the test expires.
    assert.strictEqual(body.testContext?.test, true);
    assert.strictEqual(body.testContext?.roundId, `test-pulse-${run}`);
    assert.strictEqual(body.testContext?.state, "open");
    assert.strictEqual(body.testContext?.hasAnswered, false);
    assert.strictEqual(body.testContext?.closeTime, body.expiresAt);
    assert.strictEqual(body.testContext?.pulseName, "Weekly team health");
    assert.strictEqual(body.testContext?.minimumGroupSize, 4);
    assert.strictEqual(body.view._tag, "Viewed");
    assert.isAbove(body.view.value.questions.length, 0);
    assert.deepStrictEqual(
      body.testContext?.questions,
      body.view.value.questions.map((question, position) => ({
        id: question.versionId,
        position,
        text: question.text,
        type: question.type,
      })),
    );
    // The Lead sees the comment with the Lead's own name redacted, and nothing without a comment.
    assert.match(body.preview.shownToLead ?? "", /\[name\]/);
    assert.notMatch(body.preview.shownToLead ?? "", /grace/i);
    assert.deepStrictEqual(body.noComment, { shownToLead: null });
  }),
);

test(
  "shows a test send's state to its sender, and lists the failed sends newest first, fifty at most (issue 147)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/test-invitations?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      sentAt: number;
      queued: unknown;
      memberRead: unknown;
      failing: string;
      failedStatus: unknown;
      failedBefore: unknown;
      failedAfter: unknown;
    };
    const sentAt = body.sentAt;
    // Queued before the queue has touched it: no attempts, and it reads as the Person's own send.
    assert.deepStrictEqual(body.queued, {
      _tag: "Viewed",
      value: {
        queuedAt: sentAt,
        checkedAt: sentAt,
        state: { _tag: "Queued", attempts: 0, lastCode: null },
      },
    });
    // Another Person's read is refused, as the editor's permission table decides.
    assert.deepStrictEqual(body.memberRead, { _tag: "Rejected", rejection: { _tag: "Forbidden" } });
    // The send the queue rejected for good: its reason and code, and the time it failed.
    assert.deepStrictEqual(body.failedStatus, {
      _tag: "Viewed",
      value: {
        queuedAt: sentAt,
        checkedAt: sentAt + 3,
        state: { _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt: sentAt + 2 },
      },
    });
    // The Organization's admins see it in the failed list: kind, recipient, reason, code, and time, no body.
    assert.deepStrictEqual(body.failedBefore, {
      _tag: "Viewed",
      value: {
        emails: [
          {
            sendId: body.failing,
            kind: "TestInvitationEmail",
            recipient: "admin@example.com",
            reason: "rejected",
            code: "E_SENDER_NOT_VERIFIED",
            failedAt: sentAt + 2,
            resendable: true,
          },
        ],
      },
    });
    // Fifty-one later failures: the list holds the newest fifty, newest first; the older test send drops out.
    const after = body.failedAfter as { _tag: string; value: { emails: Array<unknown> } };
    assert.strictEqual(after._tag, "Viewed");
    assert.strictEqual(after.value.emails.length, 50);
    assert.deepStrictEqual(after.value.emails[0], {
      sendId: `bulk-${run}-50`,
      kind: "AddedToTeam",
      recipient: "grace@example.com",
      reason: "abandoned",
      code: null,
      failedAt: sentAt + 150,
      resendable: true,
    });
    assert.deepStrictEqual(after.value.emails[49], {
      sendId: `bulk-${run}-1`,
      kind: "AddedToTeam",
      recipient: "grace@example.com",
      reason: "abandoned",
      code: null,
      failedAt: sentAt + 101,
      resendable: true,
    });
  }),
);

test(
  "resends a failed email once for an admin, through the queue, and refuses the rest (issue 159)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/resend-email?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      failedBefore: { _tag: string; value: { emails: Array<{ recipient: string; resendable: boolean }> } };
      revokedResend: unknown;
      staleResend: unknown;
      leadResend: unknown;
      memberResend: unknown;
      stillFailed: { _tag: string } | null;
      otherResend: unknown;
      first: { _tag: string; queue: boolean; status: { sendId: string; state: { _tag: string } } };
      second: { _tag: string; queue: boolean; status: { sendId: string; state: { _tag: string } } };
      adaResend: { _tag: string; queue: boolean; status: { sendId: string; state: { _tag: string } } };
      failedInvitationsAfter: Array<string>;
      sent: { _tag: string } | null;
      captured: Array<{ recipient: string; subject: string }>;
      listedAfter: { _tag: string; value: { emails: Array<{ recipient: string }> } };
      statusAfter: { _tag: string; value: { state: { _tag: string } } };
    };
    const added = `added-${run}`;
    const recipient = `resent-${run}@example.com`;

    // Failed Invitations: the current one may be resent; a revoked one and one re-sent since may not.
    assert.strictEqual(body.failedBefore._tag, "Viewed");
    const resendableOf = (address: string) =>
      body.failedBefore.value.emails.find((each) => each.recipient === address)?.resendable;
    assert.strictEqual(resendableOf("ada@example.com"), true);
    assert.strictEqual(resendableOf("bob@example.com"), false);
    assert.strictEqual(resendableOf("grace@example.com"), false);
    const refused = { _tag: "Rejected", rejection: { _tag: "EmailNotResendable" } };
    assert.deepStrictEqual(body.revokedResend, refused);
    assert.deepStrictEqual(body.staleResend, refused);

    // A Lead and a member are not Organization admins, and another Organization's admin cannot see this send.
    const forbidden = { _tag: "Rejected", rejection: { _tag: "Forbidden" } };
    assert.deepStrictEqual(body.leadResend, forbidden);
    assert.deepStrictEqual(body.memberResend, forbidden);
    assert.strictEqual(body.stillFailed?._tag, "Failed");
    assert.deepStrictEqual(body.otherResend, {
      _tag: "Rejected",
      rejection: { _tag: "FailedEmailNotFound" },
    });

    // The admin's double click: both queue the send (the second re-queues it while it waits); it is still sent once.
    const queued = { _tag: "Queued", attempts: 0, lastCode: null };
    assert.deepStrictEqual(body.first, {
      _tag: "Accepted",
      queue: true,
      status: { sendId: added, state: queued },
    });
    assert.strictEqual(body.second._tag, "Accepted");
    assert.strictEqual(body.second.queue, true);
    assert.strictEqual(body.second.status.sendId, added);

    // Ada's current Invitation goes out again, and the Lead's failed list stops showing it.
    assert.strictEqual(body.adaResend._tag, "Accepted");
    assert.strictEqual(body.adaResend.queue, true);
    assert.notInclude(body.failedInvitationsAfter, `member-${run}`);

    // The queue delivered the email once: one captured message to that address, and the send is sent.
    assert.strictEqual(body.sent?._tag, "Sent");
    assert.deepStrictEqual(
      body.captured.map((each) => each.recipient),
      [recipient],
    );

    // Once sent it is no longer a failed email, and its status reads as sent.
    assert.notInclude(
      body.listedAfter.value.emails.map((each) => each.recipient),
      recipient,
    );
    assert.strictEqual(body.statusAfter._tag, "Viewed");
    assert.strictEqual(body.statusAfter.value.state._tag, "Sent");
  }),
);

test(
  "Round lifecycle engine: alarm points at earliest due job, next Round is never duplicated, and jobs are idempotent",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/rounds?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      initialAlarm: unknown;
      earliestDue1: unknown;
      alarmPointsToEarliest1: boolean;
      notDuplicated: boolean;
      openIdempotent: boolean;
      hasFailedInv: boolean;
      resendSuccess: boolean;
      resendCountIncremented: boolean;
      closeIdempotent: boolean;
      hasComputedResult: boolean;
      alarmPointsToEarliest2: boolean;
      tokenDerivedMatchesHash: boolean;
      tokenNotPersistedAfterOpen: boolean;
      resendTokenDerivedMatchesHash: boolean;
      tokenNotPersistedAfterResend: boolean;
      renderedText: string;
      token0: string;
      organizationId: string;
    };
    assert.strictEqual(body.alarmPointsToEarliest1, true);
    assert.strictEqual(body.notDuplicated, true);
    assert.strictEqual(body.openIdempotent, true);
    assert.strictEqual(body.hasFailedInv, true);
    assert.strictEqual(body.resendSuccess, true);
    assert.strictEqual(body.resendCountIncremented, true);
    assert.strictEqual(body.closeIdempotent, true);
    assert.strictEqual(body.hasComputedResult, true);
    assert.strictEqual(body.alarmPointsToEarliest2, true);

    // Invitation tokens are derived, never stored (issue 42): the hash validates the derived token, and
    // no job payload or send content holds it, neither after opening nor after a Resend.
    assert.strictEqual(body.tokenDerivedMatchesHash, true);
    assert.strictEqual(body.tokenNotPersistedAfterOpen, true);
    assert.strictEqual(body.resendTokenDerivedMatchesHash, true);
    assert.strictEqual(body.tokenNotPersistedAfterResend, true);

    // The Queue consumer derives the same token when it renders the email, so the link still works.
    assert.include(body.renderedText, `/a#t=${body.token0}`);
    assert.include(body.renderedText, "at least 4 people");
  }),
  { timeout: 120_000 },
);

test(
  "Invitations, reminders, and delivery preferences: zero writes on GET/HEAD, delivery timezone change, RFC 8058 unsubscribe",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const roundRes = yield* Effect.promise(() => fetch(`${url}/__test/rounds?run=${run}`));
    assert.strictEqual(roundRes.status, 200);
    const roundData = (yield* Effect.promise(() => roundRes.json())) as {
      testToken: string;
      organizationId: string;
      leadPersonId: string;
      pulseId: string;
    };
    const { testToken } = roundData;

    // 1. GET /delivery?token=... returns HTML (zero writes)
    const delGet = yield* Effect.promise(() => fetch(`${url}/delivery?token=${testToken}`));
    assert.strictEqual(delGet.status, 200);
    const delGetHtml = yield* Effect.promise(() => delGet.text());
    assert.include(delGetHtml, "Change delivery time");
    assert.include(delGetHtml, "Europe/Berlin");

    // 2. HEAD /delivery?token=... returns 200 (zero writes)
    const delHead = yield* Effect.promise(() =>
      fetch(`${url}/delivery?token=${testToken}`, { method: "HEAD" }),
    );
    assert.strictEqual(delHead.status, 200);

    // 3. POST /delivery changes time zone in DO
    const delPost = yield* Effect.promise(() =>
      fetch(`${url}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: testToken, timeZone: "America/New_York" }),
      }),
    );
    assert.strictEqual(delPost.status, 200);
    const delPostJson = (yield* Effect.promise(() => delPost.json())) as { ok: boolean; timeZone: string };
    assert.strictEqual(delPostJson.ok, true);
    assert.strictEqual(delPostJson.timeZone, "America/New_York");

    // 4. GET /api/reminders/unsubscribe?t=... returns HTML (zero writes)
    const unsubGet = yield* Effect.promise(() => fetch(`${url}/api/reminders/unsubscribe?t=${testToken}`));
    assert.strictEqual(unsubGet.status, 200);
    const unsubGetHtml = yield* Effect.promise(() => unsubGet.text());
    assert.include(unsubGetHtml, "Turn off reminders");

    // 5. HEAD /api/reminders/unsubscribe?t=... returns 200 (zero writes)
    const unsubHead = yield* Effect.promise(() =>
      fetch(`${url}/api/reminders/unsubscribe?t=${testToken}`, { method: "HEAD" }),
    );
    assert.strictEqual(unsubHead.status, 200);

    // 6. POST /api/reminders/unsubscribe (RFC 8058 one-click): returns 200, NO redirect
    const unsubPost = yield* Effect.promise(() =>
      fetch(`${url}/api/reminders/unsubscribe?t=${testToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    assert.strictEqual(unsubPost.status, 200);
    const unsubText = yield* Effect.promise(() => unsubPost.text());
    assert.include(unsubText, "Reminders for this Pulse are turned off.");
    assert.include(unsubPost.headers.get("content-type") ?? "", "charset=utf-8");

    // 7. A German link renders the page in German (ADR 0018)
    const unsubGetDe = yield* Effect.promise(() =>
      fetch(`${url}/api/reminders/unsubscribe?t=${testToken}&lang=de`),
    );
    const unsubGetDeHtml = yield* Effect.promise(() => unsubGetDe.text());
    assert.include(unsubGetDeHtml, '<html lang="de">');
    assert.include(unsubGetDeHtml, "Erinnerungen ausschalten");
  }),
);

test(
  "Review window: window 0 shares at close, a Lead shares by hand, and the window's end shares automatically",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/review?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body: unknown = yield* Effect.promise(() => response.json());
    assert.deepStrictEqual(body, {
      // Window 0 (R1 behaviour): shared at close, no share job, and every Person gets a results-ready email.
      zero: {
        roundStatus: "shared",
        shareJobs: 0,
        resultsReadyFor: ["lead", "member", "other"],
        memberSeesQuestions: true,
      },
      // Window 3, shared by hand: ready at close, share job three days later, only the Lead has an email yet.
      manual: {
        roundStatus: "ready",
        shareJobDueDays: 3,
        shareJobStatus: "pending",
        resultsReadyBefore: ["lead"],
        leadView: {
          status: "ready",
          seesQuestions: true,
          seesDimensions: true,
          seesComments: true,
          seesGuideKey: true,
          reviewEndsAtIsShareDue: true,
        },
        memberView: {
          status: "ready",
          seesQuestions: false,
          seesDimensions: false,
          seesComments: false,
          seesGuideKey: false,
          reviewEndsAtIsShareDue: true,
        },
        memberCommand: "Forbidden",
        adminCommand: "Forbidden",
        leadFirstShare: "Accepted",
        leadSecondShare: "Accepted",
        roundStatusAfterShare: "shared",
        shareJobStatusAfterShare: "cancelled",
        resultsReadyAfter: ["lead", "member", "other"],
        leadViewAfter: {
          status: "shared",
          seesQuestions: true,
          seesDimensions: true,
          seesComments: true,
          seesGuideKey: true,
          reviewEndsAtIsShareDue: false,
        },
        memberViewAfter: {
          status: "shared",
          seesQuestions: true,
          seesDimensions: true,
          seesComments: false,
          seesGuideKey: false,
          reviewEndsAtIsShareDue: false,
        },
        leadSeesNoteBefore: true,
        memberSeesNoteBefore: false,
        memberSeesNoteAfter: true,
      },
      // Window 3, changed to 7 after close: the share job keeps its due time; running it twice and then the
      // due jobs shares the Round once.
      auto: {
        roundStatus: "ready",
        shareJobDueDays: 3,
        roundStatusAfterWindow: "shared",
        shareJobStatusAfterWindow: "completed",
        resultsReadyAfter: ["lead", "member", "other"],
        memberSeesQuestionsAfter: true,
      },
      // Cascade (window 7): A is Ready, then the next Round B is Ready too. Sharing B shares A as well: both
      // Rounds are shared, both share jobs cancelled, and each Person has exactly one results-ready job per Round.
      cascade: {
        shareCommand: "Accepted",
        roundA: {
          roundStatus: "shared",
          shareJobStatus: "cancelled",
          resultsReadyFor: ["lead", "member", "other"],
        },
        roundB: {
          roundStatus: "shared",
          shareJobStatus: "cancelled",
          resultsReadyFor: ["lead", "member", "other"],
        },
      },
      // Close early (window 2): the Round is Ready, and its share job is due two days after it closed.
      closeEarly: {
        command: "Accepted",
        roundStatus: "ready",
        shareJobStatus: "pending",
        shareJobDueDays: 2,
      },
    });
  }),
  { timeout: 240_000 },
);

test(
  "Comment themes: a meets-N close requests one themes call, which gives up without a key and shows as unavailable; AI off requests none",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/themes?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as Record<string, Record<string, unknown>>;
    // AI on: the stage has no OpenRouter key, so the call gives up and the themes are stored as failed.
    // The Lead sees the failure and a null guide; a member sees no discussionGuide key at all.
    assert.deepStrictEqual(body["withAi"], {
      themesJobExisted: true,
      themesJobCompleted: true,
      storedStatus: "failed",
      leadThemesStatus: "unavailable",
      leadHasDiscussionGuideKey: true,
      leadDiscussionGuide: null,
      leadHasComments: true,
      memberThemesStatus: "unavailable",
      memberHasDiscussionGuideKey: false,
      memberThemes: [],
      memberHasComments: false,
    });
    // AI off: nothing is requested, so no job and no record; the Lead sees "notRequested".
    assert.deepStrictEqual(body["withoutAi"], {
      themesJobExisted: false,
      themesJobCompleted: false,
      storedStatus: null,
      leadThemesStatus: "notRequested",
      leadHasDiscussionGuideKey: true,
      leadDiscussionGuide: null,
      leadHasComments: true,
      memberThemesStatus: "notRequested",
      memberHasDiscussionGuideKey: false,
      memberThemes: [],
      memberHasComments: false,
    });
  }),
  { timeout: 240_000 },
);

test(
  "Result recovery: a failed compute retries with backoff, gives up within 24 hours, and the Lead's retry computes it",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/result-recovery?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body: unknown = yield* Effect.promise(() => response.json());
    assert.deepStrictEqual(body, {
      // a: two failures, then success. Retries at 5 and then 10 minutes; a doubled alarm changes nothing; the Review
      // window ends 3 days after the Result is computed.
      failThenSucceed: {
        roundAtClose: "closed",
        computeAtClose: { status: "pending", attempts: 1, dueMinutesAfterClose: 5 },
        leadAtClose: { status: "closed", delayed: true, couldNotCompute: false, couldNotComputeKey: false },
        memberAtClose: { status: "closed", delayed: true, couldNotCompute: false, couldNotComputeKey: false },
        doubledAlarm: { status: "pending", attempts: 1, dueUnchanged: true },
        afterSecondFailure: { status: "pending", attempts: 2, dueMinutesLater: 10 },
        roundAfterSuccess: "ready",
        computeAfterSuccess: "completed",
        reviewEndsAtDays: 3,
        shareJobDueIsReviewEnd: true,
        leadAfterSuccess: {
          status: "ready",
          delayed: false,
          couldNotCompute: false,
          couldNotComputeKey: false,
        },
      },
      // b: every attempt fails. Attempts at 0, 5, 15, 35, 75, 155, 315, 555, 795, 1035, 1275 minutes after close (the
      // backoff, capped at 4 hours); the next would fall after 24 hours, so the job gives up. The Lead sees that the
      // Result could not be computed; a member sees only that it is delayed.
      giveUp: {
        attemptOffsetsMinutes: [0, 5, 15, 35, 75, 155, 315, 555, 795, 1035, 1275],
        withinWindow: true,
        roundStatus: "closed",
        computeStatus: "completed",
        leadView: { status: "closed", delayed: true, couldNotCompute: true, couldNotComputeKey: true },
        memberView: { status: "closed", delayed: true, couldNotCompute: false, couldNotComputeKey: false },
      },
      // c: only the Lead may retry; a doubled click computes the Result once.
      leadRetry: {
        memberRetry: "Forbidden",
        adminRetry: "Forbidden",
        leadFirstRetry: "Accepted",
        leadSecondRetry: "Accepted",
        roundStatus: "ready",
        reviewEndsAtDays: 3,
        computeJobStatuses: ["completed", "completed"],
        leadView: { status: "ready", delayed: false, couldNotCompute: false, couldNotComputeKey: false },
      },
      // d: the Lead's retry fails once, so the Lead sees the Result as still being retried; the next attempt succeeds.
      failedRetry: {
        firstRetry: "Accepted",
        secondRetry: "Accepted",
        computeJobStatuses: ["completed", "pending"],
        pendingAttempts: 1,
        pendingDueMinutesLater: 5,
        leadWhileRetrying: {
          status: "closed",
          delayed: true,
          couldNotCompute: false,
          couldNotComputeKey: false,
        },
        roundStatus: "ready",
        leadAfterSuccess: {
          status: "ready",
          delayed: false,
          couldNotCompute: false,
          couldNotComputeKey: false,
        },
      },
      // e: nothing to retry. An Open or Cancelled Round is rejected with its status; another Team's Lead gets
      // RoundNotFound; this Round's Lead naming a Team they have no role in is Forbidden; no compute job is created.
      nothingToRetry: {
        whileOpen: { outcome: "InvalidRoundState", status: "open" },
        otherTeamLead: { outcome: "RoundNotFound", status: null },
        ownLeadNamingOtherTeam: { outcome: "Forbidden", status: null },
        cancelled: "Accepted",
        afterCancel: { outcome: "InvalidRoundState", status: "cancelled" },
        roundStatus: "cancelled",
        computeJobs: 0,
      },
    });
  }),
  { timeout: 240_000 },
);
