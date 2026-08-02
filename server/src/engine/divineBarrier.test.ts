import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  buildDivineBarrierActiveOffers,
  DivineBarrierActiveSession,
  DivineBarrierDamageSession,
} from "./divineBarrier.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { AttackResponseSession } from "./response.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { advanceTimeline } from "./timeline.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "barrier",
    firstSeat: 1,
    seed: 727,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.paladin",
      2: "character.knight",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:barrier",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 1000,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return state;
}
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
function blueRefs(state: AuthoritativeGameState) {
  const colors = new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((item) => [item.cardId, item.color]),
  );
  return Object.values(state.cards)
    .filter((card) => colors.get(card.templateId) === "blue")
    .slice(0, 2)
    .map((card) => card.cardRef);
}
describe("Paladin Divine Barrier active mode", () => {
  it("pays blue cards across legal zones, grants only invincible, and shares CD=1", () => {
    let state = ready();
    const refs = blueRefs(state);
    relocate(state, refs[0]!, "hand:1");
    relocate(state, refs[1]!, "armor:1");
    const offer = buildDivineBarrierActiveOffers(state, ruleset, 1)[0]!;
    expect(offer.legalCardRefs).toEqual(expect.arrayContaining(refs));
    const session = new DivineBarrierActiveSession(state, ruleset),
      window = state.pendingWindows[0]!,
      result = session.handle({
        commandId: "barrier-active",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: offer.offerId,
        cardRefs: refs,
      });
    expect(result.accepted).toBe(true);
    state = session.state;
    expect(
      state.players[0]!.statuses.some(
        (status) => status.statusId === "status.invincible",
      ),
    ).toBe(true);
    expect(state.players[0]!.markers.divineBarrierOwnerPreparesUntilReady).toBe(
      2,
    );
    expect(
      result.accepted &&
        result.events.some(
          (event) =>
            event.eventType === "card.lost" &&
            (event.payload as Record<string, unknown>).cardRef === refs[1],
        ),
    ).toBe(true);
    expect(buildDivineBarrierActiveOffers(state, ruleset, 1)).toHaveLength(0);
  });

  it("expires invincible at the next own prepare-before but becomes ready only at the following own prepare", () => {
    let state = ready();
    const refs = blueRefs(state);
    for (const ref of refs) relocate(state, ref, "hand:1");
    const session = new DivineBarrierActiveSession(state, ruleset),
      offer = buildDivineBarrierActiveOffers(state, ruleset, 1)[0]!,
      window = state.pendingWindows[0]!;
    session.handle({
      commandId: "activate",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: window.promptId,
      offerId: offer.offerId,
      cardRefs: refs,
    });
    state = session.state;
    state.pendingWindows = [];
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.activeSeat).toBe(2);
    state.activeSeat = 4;
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.activeSeat).toBe(1);
    expect(
      state.players[0]!.statuses.some(
        (status) => status.statusId === "status.invincible",
      ),
    ).toBe(false);
    expect(state.players[0]!.markers.divineBarrierOwnerPreparesUntilReady).toBe(
      1,
    );
    state.activeSeat = 4;
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.players[0]!.markers.divineBarrierOwnerPreparesUntilReady).toBe(
      0,
    );
  });

  it("offers before every damage occurrence; pass is free and activation prevents that segment", () => {
    let state = ready();
    state.pendingWindows = [];
    state.activeSeat = 2;
    const refs = blueRefs(state);
    for (const ref of refs) relocate(state, ref, "hand:1");
    const tx = new EngineTransaction(state);
    createScriptedAttackInTransaction(tx, {
      attackId: "attack:barrier-response",
      attackerSeat: 2,
      targetRef: "character:1",
      sourceRef: "character:2",
      weaponId: "test",
      modeId: "test",
      range: "unlimited",
      attackTypes: ["ranged"],
      damageSegments: [
        {
          segmentId: "double",
          deliveryType: "attack",
          attackType: "ranged",
          damageType: "normal",
          element: "none",
          amount: 2,
          repeat: 2,
          isAdditional: false,
          overflowPolicy: "normal",
        } as unknown as JsonValue,
      ],
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    state = runCombatUntilBlocked(committed.state, ruleset, () => 1000).state;
    const attackResponse = new AttackResponseSession(state, ruleset),
      attackWindow = state.pendingWindows[0]!;
    attackResponse.handle({
      commandId: "attack-pass",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: attackWindow.promptId,
      offerId: attackWindow.legalOfferIds.find((offer) =>
        offer.includes(":pass:"),
      )!,
    });
    state = runCombatUntilBlocked(
      attackResponse.state,
      ruleset,
      () => 1000,
    ).state;
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "divineBarrierDamage",
      prioritySeat: 1,
    });
    let barrier = new DivineBarrierDamageSession(state, ruleset),
      barrierWindow = state.pendingWindows[0]!;
    barrier.handle({
      commandId: "barrier-pass",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: barrierWindow.promptId,
      offerId: barrierWindow.legalOfferIds.find((offer) =>
        offer.includes(":pass:"),
      )!,
      cardRefs: [],
    });
    state = runCombatUntilBlocked(barrier.state, ruleset, () => 1000).state;
    expect(state.players[0]!.shield).toBe(8);
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "divineBarrierDamage",
    });
    barrier = new DivineBarrierDamageSession(state, ruleset);
    barrierWindow = state.pendingWindows[0]!;
    barrier.handle({
      commandId: "barrier-activate",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: barrierWindow.promptId,
      offerId: barrierWindow.legalOfferIds.find((offer) =>
        offer.includes(":activate:"),
      )!,
      cardRefs: refs,
    });
    const resolved = runCombatUntilBlocked(barrier.state, ruleset, () => 1000);
    expect(resolved.state.players[0]!.shield).toBe(8);
    expect(
      resolved.events.some(
        (event) =>
          event.eventType === "damage.prevented" &&
          (event.payload as Record<string, unknown>).reason === "invincible",
      ),
    ).toBe(true);
  });

  it("also responds to direct damage before the scheduled effect is consumed", () => {
    let state = ready();
    state.pendingWindows = [];
    const refs = blueRefs(state);
    for (const ref of refs) relocate(state, ref, "hand:1");
    state.scheduledEffects.push({
      scheduledId: "scheduled:barrier-direct",
      sourceRef: "character:2",
      controllerSeat: 2,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "createDamage",
        targetRef: "character:1",
        amount: 3,
        damageType: "normal",
        element: "none",
      },
      cancelled: false,
    });
    state = runAutomaticScheduler(state, ruleset, () => 1200).state;
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "divineBarrierDamage",
      prioritySeat: 1,
      deadlineAt: 1200,
    });
    expect(state.scheduledEffects).toHaveLength(1);
    const session = new DivineBarrierDamageSession(state, ruleset),
      window = state.pendingWindows[0]!;
    session.handle({
      commandId: "direct-activate",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((offer) =>
        offer.includes(":activate:"),
      )!,
      cardRefs: refs,
    });
    const resolved = runAutomaticScheduler(session.state, ruleset, () => 1200);
    expect(resolved.state.players[0]!.shield).toBe(10);
    expect(resolved.state.scheduledEffects).toHaveLength(0);
  });
});
