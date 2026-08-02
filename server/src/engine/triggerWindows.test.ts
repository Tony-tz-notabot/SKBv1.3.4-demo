import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import {
  matchTriggeredEffects,
  type CompiledTriggerDefinition,
} from "./triggerRegistry.js";
import {
  openOptionalTriggerWindow,
  openTriggerOrderingWindow,
  OptionalTriggerSession,
  optionalTriggerCanResolveWithoutSelections,
  TriggerOrderingSession,
} from "./triggerWindows.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = {
    1: "character.knight",
    2: "character.alchemist",
    3: "character.ranger",
    4: "character.wizard",
  } as const;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function started() {
  let state = createInitialSetup(ruleset, {
    gameId: "trigger-window",
    firstSeat: 1,
    seed: 107,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.players[0]!.initialTalentIds.push("talent.optional-test");
  return state;
}
const definition = (
  effects: CompiledTriggerDefinition["effects"],
  costs: CompiledTriggerDefinition["costs"] = [],
): CompiledTriggerDefinition => ({
  triggerId: "optional-test",
  sourceFile: "test",
  sourcePath: "optional",
  familyId: "talent.optional-test",
  eventType: "test.event",
  mandatory: false,
  optional: true,
  timing: null,
  scope: null,
  priorityName: "optionalModifier",
  priority: 600,
  filter: {},
  costs,
  effects,
});
const event = { eventType: "test.event", payload: {} } as const;
const mandatoryDefinition = (
  triggerId: string,
  effects: CompiledTriggerDefinition["effects"],
): CompiledTriggerDefinition => ({
  ...definition(effects),
  triggerId,
  sourcePath: triggerId,
  mandatory: true,
  optional: false,
  priorityName: "mandatoryModifier",
  priority: 700,
});

describe("optional trigger window", () => {
  it("opens a pass-or-activate offer and activates atomically", () => {
    const state = started();
    state.players[0]!.hp = 2;
    const candidate = matchTriggeredEffects(
        state,
        [
          definition([
            { op: "recoverHp", target: "$controller", params: { amount: 2 } },
          ]),
        ],
        event,
      )[0]!,
      opened = openOptionalTriggerWindow(state, candidate, event, 900);
    expect(opened.state.pendingWindows[0]).toMatchObject({
      kind: "optionalTrigger",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
    });
    const window = opened.state.pendingWindows[0]!,
      session = new OptionalTriggerSession(opened.state, ruleset),
      command = {
        commandId: "activate",
        gameId: state.gameId,
        expectedStateRevision: opened.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds.find((id) => id.includes(":activate:"))!,
      },
      result = session.handle(command);
    expect(result.accepted).toBe(true);
    expect(session.state.players[0]!.hp).toBe(4);
    expect(session.state.pendingWindows).toHaveLength(0);
    expect(session.handle(command)).toEqual(result);
  });
  it("rejects the wrong actor without changing the window", () => {
    const state = started(),
      candidate = matchTriggeredEffects(state, [definition([])], event)[0]!,
      opened = openOptionalTriggerWindow(state, candidate, event, 900),
      window = opened.state.pendingWindows[0]!,
      session = new OptionalTriggerSession(opened.state, ruleset),
      before = structuredClone(session.state);
    expect(
      session.handle({
        commandId: "wrong",
        gameId: state.gameId,
        expectedStateRevision: opened.state.stateRevision,
        actorUserId: "u2",
        promptId: window.promptId,
        offerId: window.legalOfferIds[0]!,
      }),
    ).toMatchObject({ accepted: false, reasonCode: "NOT_YOUR_PRIORITY" });
    expect(session.state).toEqual(before);
  });
  it("uses the same pass command path for timeout", () => {
    const state = started(),
      candidate = matchTriggeredEffects(state, [definition([])], event)[0]!,
      opened = openOptionalTriggerWindow(state, candidate, event, 900),
      session = new OptionalTriggerSession(opened.state, ruleset);
    expect(session.handleTimeout("timeout").accepted).toBe(true);
    expect(session.state.pendingWindows).toHaveLength(0);
    expect(session.state.history.domainEvents.at(-1)?.eventType).toBe(
      "trigger.passed",
    );
  });
  it("routes costs and selection effects to specialized trigger windows", () => {
    const state = started(),
      withCost = matchTriggeredEffects(
        state,
        [definition([], [{ kind: "playCardFromHand" }])],
        event,
      )[0]!,
      withSelection = matchTriggeredEffects(
        state,
        [definition([{ op: "selectTargets" }])],
        event,
      )[0]!;
    expect(optionalTriggerCanResolveWithoutSelections(withCost)).toBe(false);
    expect(optionalTriggerCanResolveWithoutSelections(withSelection)).toBe(
      false,
    );
    expect(() =>
      openOptionalTriggerWindow(state, withSelection, event, 900),
    ).toThrow("TRIGGER_REQUIRES_SPECIALIZED_SELECTION");
  });
});

describe("same-controller trigger ordering", () => {
  it("opens a mandatory ordering offer and executes the selected trigger", () => {
    const state = started();
    state.players[0]!.hp = 2;
    state.players[0]!.shield = 2;
    const candidates = matchTriggeredEffects(
        state,
        [
          mandatoryDefinition("heal", [
            { op: "recoverHp", target: "$controller", params: { amount: 2 } },
          ]),
          mandatoryDefinition("shield", [
            {
              op: "recoverShield",
              target: "$controller",
              params: { amount: 2 },
            },
          ]),
        ],
        event,
      ),
      opened = openTriggerOrderingWindow(state, candidates, event, 900),
      window = opened.state.pendingWindows[0]!,
      session = new TriggerOrderingSession(opened.state, ruleset),
      result = session.handle({
        commandId: "choose-shield",
        gameId: state.gameId,
        expectedStateRevision: opened.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds[1]!,
      });
    expect(result.accepted).toBe(true);
    expect(session.state.players[0]).toMatchObject({ hp: 2, shield: 4 });
    expect(session.state.pendingWindows).toHaveLength(0);
    expect(
      session.handle({
        commandId: "choose-shield",
        gameId: state.gameId,
        expectedStateRevision: opened.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds[1]!,
      }),
    ).toEqual(result);
  });
  it("uses recorded reproducible randomness when a mandatory ordering choice times out", () => {
    const state = started(),
      candidates = matchTriggeredEffects(
        state,
        [mandatoryDefinition("a", []), mandatoryDefinition("b", [])],
        event,
      ),
      opened = openTriggerOrderingWindow(state, candidates, event, 900),
      session = new TriggerOrderingSession(opened.state, ruleset);
    expect(session.handleTimeout("ordering-timeout").accepted).toBe(true);
    expect(session.state.randomHistory.at(-1)?.purpose).toBe(
      "timeout.triggerOrdering",
    );
    expect(session.state.pendingWindows).toHaveLength(0);
  });
});
