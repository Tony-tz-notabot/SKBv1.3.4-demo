import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { BerserkerRageSession } from "./berserkerRage.js";
import { resolvePhaseBody } from "./phaseBody.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { handCards } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "rage",
    firstSeat: 1,
    seed: 809,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.berserker",
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "draw";
  state.phaseBoundary = "body";
  state.phaseMode = "automatic";
  state.phaseBodyResolved = false;
  return resolvePhaseBody(state, ruleset, 900).state;
}
function choose(state: ReturnType<typeof ready>, value: 0 | 1 | 2) {
  const window = state.pendingWindows[0]!;
  return {
    commandId: `rage-${value}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: window.promptId,
    offerId: `offer:berserker-rage:${value}`,
  };
}
describe("Berserker Rage", () => {
  it("chooses two before drawing, draws two fewer, grants one attack count and arms weapon critical", () => {
    let state = ready();
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "berserkerRage",
      legalOfferIds: [
        "offer:berserker-rage:0",
        "offer:berserker-rage:1",
        "offer:berserker-rage:2",
      ],
    });
    const before = handCards(state, 1).length,
      limitId = ruleset.settings.combat.attackCountLimitId,
      attackCount = Number(state.players[0]!.limits[limitId] ?? 0),
      session = new BerserkerRageSession(state, ruleset),
      first = session.handle(choose(state, 2)),
      repeated = session.handle(choose(state, 2));
    expect(first.accepted).toBe(true);
    expect(repeated).toEqual(first);
    state = resolvePhaseBody(session.state, ruleset, 900).state;
    expect(handCards(state, 1)).toHaveLength(before);
    expect(state.players[0]!.limits[limitId]).toBe(attackCount + 1);
    expect(state.players[0]!.markers.guaranteedCriticalGrants).toMatchObject([
      { appliesTo: "weaponAttack", expiryPoint: "owner.currentTurn.end" },
    ]);
    expect(
      state.players[0]!.markers["berserker.rageResolvedForCurrentDraw"],
    ).toBeUndefined();
  });
  it("times out to pass and performs the normal draw without a critical grant", () => {
    const opened = ready(),
      before = handCards(opened, 1).length,
      session = new BerserkerRageSession(opened, ruleset);
    expect(session.handleTimeout("rage-timeout").accepted).toBe(true);
    const state = resolvePhaseBody(session.state, ruleset, 900).state;
    expect(handCards(state, 1)).toHaveLength(
      before + ruleset.settings.defaultDrawCount,
    );
    expect(state.players[0]!.markers.guaranteedCriticalGrants).toBeUndefined();
  });
});
