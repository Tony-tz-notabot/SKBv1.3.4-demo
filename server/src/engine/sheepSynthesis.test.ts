import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  buildSheepSynthesisOffers,
  SheepSynthesisSession,
} from "./sheepSynthesis.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function relocate(state: AuthoritativeGameState, ref: string, zoneRef: string) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[zoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  target.orderedCardRefs.push(ref);
  Object.assign(card, {
    zoneRef,
    ownerSeat: target.ownerSeat,
    controllerSeat: target.ownerSeat,
    faceUp: !zoneRef.startsWith("hand:"),
  });
}
function ready(includeGirl = true) {
  let state = createInitialSetup(ruleset, {
    gameId: "sheep-synthesis",
    firstSeat: 1,
    seed: 303,
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
  const boy = Object.values(state.cards).find(
      (card) => card.templateId === "special.sp01",
    )!,
    girl = Object.values(state.cards).find(
      (card) => card.templateId === "special.sp02",
    )!;
  relocate(state, boy.cardRef, "hand:1");
  if (includeGirl) relocate(state, girl.cardRef, "hand:1");
  Object.assign(state, {
    activeSeat: 1,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  state.pendingWindows = [
    {
      promptId: "play:synthesis",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, boy: boy.cardRef, girl: girl.cardRef };
}
describe("Sheep synthesis", () => {
  it("requires both exact materials", () => {
    const prepared = ready(false);
    expect(buildSheepSynthesisOffers(prepared.state, ruleset, 1)).toEqual([]);
  });
  it("consumes both materials and creates a hand product that exits outside deck", () => {
    const prepared = ready(),
      session = new SheepSynthesisSession(prepared.state, ruleset),
      command = {
        commandId: "synthesize",
        gameId: prepared.state.gameId,
        expectedStateRevision: prepared.state.stateRevision,
        actorUserId: "u1",
        promptId: "play:synthesis",
        offerId: "offer:synthesize:special.sp03:1",
        boyRef: prepared.boy,
        girlRef: prepared.girl,
      },
      result = session.handle(command);
    expect(result.accepted).toBe(true);
    expect(session.handle(command)).toEqual(result);
    expect(session.state.cards[prepared.boy]!.zoneRef).toBe("discardPile");
    expect(session.state.cards[prepared.girl]!.zoneRef).toBe("discardPile");
    const productRef = result.accepted ? result.productRef : "";
    expect(session.state.cards[productRef]).toMatchObject({
      templateId: "special.sp03",
      zoneRef: "hand:1",
      runtime: { generatedExitZoneRef: "outsideDeck" },
    });
    const tx = new EngineTransaction(session.state);
    moveCardInTransaction(tx, {
      cardRef: productRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    expect(tx.draft.cards[productRef]!.zoneRef).toBe("outsideDeck");
  });
  it("rejects stale material choices without mutation", () => {
    const prepared = ready(),
      session = new SheepSynthesisSession(prepared.state, ruleset),
      before = prepared.state.stateRevision,
      result = session.handle({
        commandId: "bad",
        gameId: prepared.state.gameId,
        expectedStateRevision: before,
        actorUserId: "u1",
        promptId: "play:synthesis",
        offerId: "offer:synthesize:special.sp03:1",
        boyRef: prepared.boy,
        girlRef: "card:missing",
      });
    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "MATERIAL_NO_LONGER_LEGAL",
    });
    expect(session.state.stateRevision).toBe(before);
  });
});
