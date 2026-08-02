import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateDrawCount } from "./drawCount.js";
import { resolvePhaseBody } from "./phaseBody.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { handCards } from "./state.js";
import { SpartanKickSession } from "./spartanKick.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "spartan-kick",
    firstSeat: 1,
    seed: 701,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.headtaker",
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "discard";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  return resolvePhaseBody(state, ruleset, 900).state;
}
function command(state: ReturnType<typeof ready>, targetRef = "character:2") {
  const window = state.pendingWindows[0]!;
  return {
    commandId: `kick-${state.stateRevision}-${targetRef}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: window.promptId,
    offerId: "offer:skill.headtaker.spartan_kick",
    cardRefs: [...handCards(state, 1)],
    targetRef,
  };
}
describe("Spartan Kick", () => {
  it("opens in discard even without a hand-limit discard and penalizes the target when shield remains", () => {
    const state = ready(),
      count = handCards(state, 1).length;
    state.players[1]!.shield = count + 2;
    expect(state.pendingWindows[0]!.legalOfferIds).toContain(
      "offer:skill.headtaker.spartan_kick",
    );
    const session = new SpartanKickSession(state, ruleset),
      result = session.handle(command(state));
    expect(result.accepted).toBe(true);
    expect(handCards(session.state, 1)).toHaveLength(0);
    expect(session.state.players[1]!.shield).toBe(2);
    expect(calculateDrawCount(session.state, 2, 2)).toMatchObject({
      rawCount: 1,
      actualCount: 1,
    });
    expect(calculateDrawCount(session.state, 1, 2).actualCount).toBe(2);
  });

  it("penalizes the Headtaker when this damage breaks the target shield", () => {
    const state = ready(),
      count = handCards(state, 1).length;
    state.players[1]!.shield = count;
    const session = new SpartanKickSession(state, ruleset),
      first = session.handle(command(state)),
      repeated = session.handle(command(state));
    expect(first.accepted).toBe(true);
    expect(repeated).toEqual(first);
    expect(session.state.players[1]!.shield).toBe(0);
    expect(calculateDrawCount(session.state, 1, 2).actualCount).toBe(1);
    expect(calculateDrawCount(session.state, 2, 2).actualCount).toBe(2);
  });

  it("rejects partial-hand payment without changing authoritative state", () => {
    const state = ready(),
      snapshot = structuredClone(state),
      session = new SpartanKickSession(state, ruleset),
      input = command(state);
    input.cardRefs.pop();
    expect(session.handle(input)).toMatchObject({
      accepted: false,
      reasonCode: "INVALID_SELECTION",
    });
    expect(session.state).toEqual(snapshot);
  });
});
