import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
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
    gameId: "shop",
    firstSeat: 1,
    seed: 613,
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
  state.players[0]!.initialTalentIds.push("talent.shop_discount");
  return state;
}
function phase(state: ReturnType<typeof ready>, kind: "prepare" | "draw") {
  state.phase = kind;
  state.phaseBoundary = "body";
  state.phaseBodyResolved = false;
  state.pendingWindows = [];
  return resolvePhaseBody(state, ruleset, 0).state;
}
describe("Shop Discount draw trigger", () => {
  it("adds one on the first eligible draw, skips one owner turn, then becomes ready", () => {
    let state = ready(),
      before = handCards(state, 1).length;
    state = phase(state, "draw");
    expect(handCards(state, 1)).toHaveLength(
      before + ruleset.settings.defaultDrawCount + 1,
    );
    expect(
      state.players[0]!.markers["talent.shopDiscount.cooldownOwnerTurns"],
    ).toBe(2);
    state = phase(state, "prepare");
    before = handCards(state, 1).length;
    state = phase(state, "draw");
    expect(handCards(state, 1)).toHaveLength(
      before + ruleset.settings.defaultDrawCount,
    );
    state = phase(state, "prepare");
    before = handCards(state, 1).length;
    state = phase(state, "draw");
    expect(handCards(state, 1)).toHaveLength(
      before + ruleset.settings.defaultDrawCount + 1,
    );
  });
  it("does not trigger an equipped copy while equipment effects are disabled", () => {
    const state = ready();
    state.players[0]!.initialTalentIds = [];
    const card = Object.values(state.cards).find(
        (item) => item.templateId === "talent.shop_discount",
      )!,
      from = state.zones[card.zoneRef]!;
    from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef), 1);
    state.zones["talent:1"]!.orderedCardRefs.push(card.cardRef);
    card.zoneRef = "talent:1";
    card.ownerSeat = card.controllerSeat = 1;
    card.faceUp = true;
    state.players[0]!.markers.equipmentEffectsDisabled = true;
    const before = handCards(state, 1).length,
      out = phase(state, "draw");
    expect(handCards(out, 1)).toHaveLength(
      before + ruleset.settings.defaultDrawCount,
    );
  });
});
