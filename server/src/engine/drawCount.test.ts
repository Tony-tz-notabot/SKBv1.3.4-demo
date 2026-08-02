import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  addDrawCountModifierInTransaction,
  calculateDrawCount,
} from "./drawCount.js";
import { resolvePhaseBody } from "./phaseBody.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { handCards } from "./state.js";
import { EngineTransaction } from "./transaction.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "draw-count",
    firstSeat: 1,
    seed: 509,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
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
  return state;
}
function commit(tx: EngineTransaction<ReturnType<typeof ready>>) {
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return out.state;
}
describe("draw-count modifier pipeline", () => {
  it("allows a negative intermediate value and clamps only the actual draw to zero", () => {
    const state = ready(),
      tx = new EngineTransaction(state);
    addDrawCountModifierInTransaction(tx, {
      seat: 1,
      modifierId: "kick.1",
      delta: -2,
    });
    addDrawCountModifierInTransaction(tx, {
      seat: 1,
      modifierId: "kick.2",
      delta: -1,
    });
    const prepared = commit(tx),
      count = calculateDrawCount(
        prepared,
        1,
        ruleset.settings.defaultDrawCount,
      ),
      before = handCards(prepared, 1).length,
      out = resolvePhaseBody(prepared, ruleset, 0);
    expect(count).toMatchObject({ rawCount: -1, actualCount: 0 });
    expect(handCards(out.state, 1)).toHaveLength(before);
    expect(
      out.events.find((event) => event.eventType === "draw.count.calculated")
        ?.payload,
    ).toMatchObject({ rawCount: -1, actualCount: 0 });
    expect(
      out.state.players[0]!.markers["draw.countModifiers"],
    ).toBeUndefined();
  });
  it("stacks modifiers and retains persistent or multi-draw durations", () => {
    const state = ready(),
      tx = new EngineTransaction(state);
    addDrawCountModifierInTransaction(tx, {
      seat: 1,
      modifierId: "shop",
      delta: 1,
      remainingAffectedDraws: 2,
    });
    addDrawCountModifierInTransaction(tx, {
      seat: 1,
      modifierId: "persistent",
      delta: -1,
      remainingAffectedDraws: null,
    });
    const prepared = commit(tx),
      out = resolvePhaseBody(prepared, ruleset, 0).state;
    expect(calculateDrawCount(prepared, 1, 2)).toMatchObject({
      rawCount: 2,
      actualCount: 2,
    });
    expect(out.players[0]!.markers["draw.countModifiers"]).toMatchObject([
      { modifierId: "shop", remainingAffectedDraws: 1 },
      { modifierId: "persistent", remainingAffectedDraws: null },
    ]);
  });
});
