import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { DyingCommandSession, openDyingRescue } from "./dying.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });

function relocate(state: AuthoritativeGameState, ref: string, zoneRef: string): void {
  const card = state.cards[ref]!;
  state.zones[card.zoneRef]!.orderedCardRefs.splice(state.zones[card.zoneRef]!.orderedCardRefs.indexOf(ref), 1);
  state.zones[zoneRef]!.orderedCardRefs.push(ref);
  Object.assign(card, { zoneRef, ownerSeat: state.zones[zoneRef]!.ownerSeat, controllerSeat: state.zones[zoneRef]!.ownerSeat, faceUp: true });
}
function prepared(disabled = false): { state: AuthoritativeGameState; cross: string } {
  let state = createInitialSetup(ruleset, {
    gameId: `w43-${disabled}`, firstSeat: 1, seed: 616,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: { 1: "character.knight", 2: "character.wizard", 3: "character.ranger", 4: "character.alchemist" },
  });
  for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.lifecycle = "inProgress";
  state.activeSeat = 1;
  state.players[1]!.hp = 0;
  state.players[1]!.lifeState = "dying";
  state.combat.dyingStack = ["character:2"];
  const cross = Object.values(state.cards).find((card) => card.templateId === "weapon.w43")!.cardRef;
  relocate(state, cross, "weapon:1:2");
  if (disabled) state.players[1]!.markers.equipmentEffectsDisabled = true;
  return { state, cross };
}

describe("W43 Resurrection Cross", () => {
  it("is offered only to its dying owner and restores them to maximum HP before being lost", () => {
    const { state: initial, cross } = prepared();
    let state = openDyingRescue(initial, 700, ruleset).state;
    let session = new DyingCommandSession(state, () => 800, ruleset);
    let window = state.pendingWindows[0]!;
    session.handle({ commandId: "seat1-pass", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))! });
    state = session.state;
    window = state.pendingWindows[0]!;
    expect(window.prioritySeat).toBe(2);
    expect(window.legalOfferIds).toContain("offer:dying:resurrectionCross:character:2");
    session = new DyingCommandSession(state, () => 900, ruleset);
    const result = session.handle({ commandId: "use-cross", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u2", promptId: window.promptId, offerId: "offer:dying:resurrectionCross:character:2", cardRef: cross });
    expect(result.accepted).toBe(true);
    expect(session.state.players[1]).toMatchObject({ lifeState: "alive", hp: session.state.players[1]!.maxHp });
    expect(session.state.cards[cross]!.zoneRef).toBe("discardPile");
  });

  it("is not offered while equipment effects are disabled", () => {
    const { state: initial } = prepared(true);
    let state = openDyingRescue(initial, 700, ruleset).state;
    const first = new DyingCommandSession(state, () => 800, ruleset), window = state.pendingWindows[0]!;
    first.handle({ commandId: "seat1-pass-disabled", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))! });
    expect(first.state.pendingWindows[0]!.legalOfferIds.some((id) => id.includes("resurrectionCross"))).toBe(false);
  });
});
