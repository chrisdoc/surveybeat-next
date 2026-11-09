import { describe, expect, it } from "@effect/vitest";
import { type ActionSelectionInput, type PreviousRoundInfo, selectActionsForRound } from "./Action.ts";

describe("selectActionsForRound", () => {
  const previousRound: PreviousRoundInfo = {
    plannedOpenAt: 1000,
    openedAt: 1000,
  };

  it("includes committed actions", () => {
    const actions: ReadonlyArray<ActionSelectionInput> = [
      {
        id: "a1",
        title: "Shorten pairing sessions",
        status: "committed",
        createdAt: 900,
        updatedAt: 900,
        doneAt: null,
      },
    ];

    const result = selectActionsForRound(actions, previousRound);
    expect(result.map((a) => a.title)).toEqual(["Shorten pairing sessions"]);
  });

  it("includes actions marked done since the previous Round opened", () => {
    const actions: ReadonlyArray<ActionSelectionInput> = [
      {
        id: "a1",
        title: "Update onboarding docs",
        status: "done",
        createdAt: 900,
        updatedAt: 1100,
        doneAt: 1100, // after previous round opened at 1000
      },
    ];

    const result = selectActionsForRound(actions, previousRound);
    expect(result.map((a) => a.title)).toEqual(["Update onboarding docs"]);
  });

  it("excludes actions marked done before the previous Round opened", () => {
    const actions: ReadonlyArray<ActionSelectionInput> = [
      {
        id: "a1",
        title: "Old finished action",
        status: "done",
        createdAt: 500,
        updatedAt: 800,
        doneAt: 800, // before previous round opened at 1000
      },
      {
        id: "a2",
        title: "Still committed action",
        status: "committed",
        createdAt: 900,
        updatedAt: 900,
        doneAt: null,
      },
    ];

    const result = selectActionsForRound(actions, previousRound);
    expect(result.map((a) => a.title)).toEqual(["Still committed action"]);
  });

  it("excludes dropped and proposed actions", () => {
    const actions: ReadonlyArray<ActionSelectionInput> = [
      {
        id: "a1",
        title: "Dropped action",
        status: "dropped",
        createdAt: 900,
        updatedAt: 1100,
        doneAt: null,
      },
      {
        id: "a2",
        title: "Proposed action",
        status: "proposed",
        createdAt: 900,
        updatedAt: 1100,
        doneAt: null,
      },
      {
        id: "a3",
        title: "Committed action",
        status: "committed",
        createdAt: 900,
        updatedAt: 900,
        doneAt: null,
      },
    ];

    const result = selectActionsForRound(actions, previousRound);
    expect(result.map((a) => a.title)).toEqual(["Committed action"]);
  });

  it("caps the displayed actions to three", () => {
    const actions: ReadonlyArray<ActionSelectionInput> = [
      { id: "a1", title: "Action 1", status: "committed", createdAt: 1, updatedAt: 1, doneAt: null },
      { id: "a2", title: "Action 2", status: "committed", createdAt: 2, updatedAt: 2, doneAt: null },
      { id: "a3", title: "Action 3", status: "done", createdAt: 3, updatedAt: 1200, doneAt: 1200 },
      { id: "a4", title: "Action 4", status: "committed", createdAt: 4, updatedAt: 4, doneAt: null },
      { id: "a5", title: "Action 5", status: "committed", createdAt: 5, updatedAt: 5, doneAt: null },
    ];

    const result = selectActionsForRound(actions, previousRound);
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.title)).toEqual(["Action 1", "Action 2", "Action 3"]);
  });

  it("handles the very first Round where previousRound is null", () => {
    const actions: ReadonlyArray<ActionSelectionInput> = [
      { id: "a1", title: "Action 1", status: "committed", createdAt: 1, updatedAt: 1, doneAt: null },
      { id: "a2", title: "Action 2", status: "done", createdAt: 2, updatedAt: 50, doneAt: 50 },
    ];

    const result = selectActionsForRound(actions, null);
    // Only committed action is shown because no previous round exists to be marked done since
    expect(result.map((a) => a.title)).toEqual(["Action 1"]);
  });

  it("falls back to plannedOpenAt if openedAt is null on the previous Round", () => {
    const unOpenedPreviousRound: PreviousRoundInfo = {
      plannedOpenAt: 2000,
      openedAt: null,
    };

    const actions: ReadonlyArray<ActionSelectionInput> = [
      {
        id: "a1",
        title: "Done before planned",
        status: "done",
        createdAt: 1000,
        updatedAt: 1500,
        doneAt: 1500,
      },
      {
        id: "a2",
        title: "Done after planned",
        status: "done",
        createdAt: 1000,
        updatedAt: 2500,
        doneAt: 2500,
      },
    ];

    const result = selectActionsForRound(actions, unOpenedPreviousRound);
    expect(result.map((a) => a.title)).toEqual(["Done after planned"]);
  });
});
