import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { OwlSession } from "./owl.js";
import { DyingCommandSession } from "./dying.js";
import { AttackResponseSession } from "./response.js";
import {
  createCompositeScriptedAttackInTransaction,
  createScriptedAttackInTransaction,
} from "./scriptedAttack.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
const segment = (amount = 2) =>
  ({
    segmentId: "test",
    deliveryType: "attack",
    attackType: "ranged",
    damageType: "normal",
    element: "none",
    amount,
    repeat: 1,
    isAdditional: false,
    overflowPolicy: "normal",
  }) as unknown as JsonValue;
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "owl",
    firstSeat: 1,
    seed: 707,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.headtaker",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  for (const player of state.players) {
    player.hp = 10;
    player.maxHp = 10;
    player.shield = 10;
    player.maxShield = 10;
  }
  state.pendingWindows = [];
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
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
function attack(state: AuthoritativeGameState, amount = 2) {
  const tx = new EngineTransaction(state);
  createScriptedAttackInTransaction(tx, {
    attackId: "attack:source",
    attackerSeat: 1,
    targetRef: "character:2",
    sourceRef: "character:1",
    weaponId: "test",
    modeId: "test",
    range: "unlimited",
    attackTypes: ["ranged"],
    damageSegments: [segment(amount)],
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  return committed.state;
}
function passAttack(state: AuthoritativeGameState, id: string) {
  const window = state.pendingWindows[0]!,
    actor = state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!,
    session = new AttackResponseSession(state, ruleset);
  session.handle({
    commandId: id,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.includes(":pass:"))!,
  });
  return session.state;
}

describe("Headtaker Owl", () => {
  it("opens only after the complete source attack damage and launches an optional unlimited ranged 2 counter", () => {
    let state = attack(ready());
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    state = passAttack(state, "source-pass");
    const triggered = runCombatUntilBlocked(state, ruleset, () => 1000);
    expect(triggered.stoppedReason).toBe("playWindow");
    expect(triggered.state.players[1]!.shield).toBe(8);
    expect(triggered.state.pendingWindows[0]).toMatchObject({
      kind: "owlCounterattack",
      prioritySeat: 2,
    });
    const owl = new OwlSession(triggered.state, ruleset),
      window = owl.state.pendingWindows[0]!,
      result = owl.handle({
        commandId: "owl-attack",
        gameId: owl.state.gameId,
        expectedStateRevision: owl.state.stateRevision,
        actorUserId: "u2",
        promptId: window.promptId,
        offerId: window.legalOfferIds.find((offer) =>
          offer.startsWith("offer:owl:attack:"),
        )!,
      });
    expect(result.accepted).toBe(true);
    expect(owl.state.combat.attack).toMatchObject({
      attackerSeat: 2,
      targetRefs: ["character:1"],
      range: "unlimited",
      attackTypes: ["ranged"],
      damageSegments: [{ amount: 2 }],
    });
    expect(owl.state.players[1]!.markers.owlUsedRound).toBe(owl.state.round);
    state = runCombatUntilBlocked(owl.state, ruleset, () => 1000).state;
    state = passAttack(state, "owl-pass");
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    expect(state.players[0]!.shield).toBe(8);
    expect(state.combat.attack).toBeNull();
  });

  it("does not consume the round limit when passed and does not trigger for zero actual damage", () => {
    let state = attack(ready());
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    state = passAttack(state, "pass-source");
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    const owl = new OwlSession(state, ruleset),
      window = owl.state.pendingWindows[0]!;
    owl.handle({
      commandId: "owl-decline",
      gameId: owl.state.gameId,
      expectedStateRevision: owl.state.stateRevision,
      actorUserId: "u2",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((offer) => offer.includes(":pass:"))!,
    });
    expect(owl.state.players[1]!.markers.owlUsedRound).toBeUndefined();
    state = attack(owl.state, 0);
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    state = passAttack(state, "zero-pass");
    const resolved = runCombatUntilBlocked(state, ruleset, () => 1000);
    expect(
      resolved.state.pendingWindows.some(
        (candidate) => candidate.kind === "owlCounterattack",
      ),
    ).toBe(false);
  });

  it("suspends a multi-target source before its next target and resumes it after the Owl attack", () => {
    const tx = new EngineTransaction(ready());
    createCompositeScriptedAttackInTransaction(tx, {
      attackId: "attack:multi",
      attackerSeat: 1,
      sourceRef: "character:1",
      weaponId: "test",
      modeId: "multi",
      range: "unlimited",
      targetGroups: [
        {
          targetRef: "character:2",
          attackTypes: ["ranged"],
          damageSegments: [segment()],
        },
        {
          targetRef: "character:3",
          attackTypes: ["ranged"],
          damageSegments: [segment()],
        },
      ],
      preserveTargetOrder: true,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    let state = committed.state;
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    state = passAttack(state, "multi-first-pass");
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    expect(state.pendingWindows[0]).toMatchObject({ kind: "owlCounterattack" });
    expect(
      (state.combat.attack as Record<string, JsonValue>).targetRefs,
    ).toEqual(["character:2", "character:3"]);
    const owl = new OwlSession(state, ruleset),
      window = owl.state.pendingWindows[0]!;
    owl.handle({
      commandId: "multi-owl",
      gameId: owl.state.gameId,
      expectedStateRevision: owl.state.stateRevision,
      actorUserId: "u2",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((offer) =>
        offer.startsWith("offer:owl:attack:"),
      )!,
    });
    state = runCombatUntilBlocked(owl.state, ruleset, () => 1000).state;
    state = passAttack(state, "multi-owl-pass");
    const resumed = runCombatUntilBlocked(state, ruleset, () => 1000);
    expect(resumed.stoppedReason).toBe("responseWindow");
    expect({
      kind: resumed.state.pendingWindows[0]?.kind,
      seat: resumed.state.pendingWindows[0]?.prioritySeat,
    }).toEqual({ kind: "attackResponse", seat: 3 });
  });

  it("completes dying rescue before offering the deferred Owl counterattack", () => {
    let state = ready();
    state.players[1]!.shield = 0;
    state.players[1]!.hp = 1;
    const potion = Object.values(state.cards).find((card) =>
      card.templateId.startsWith("basic.potion."),
    )!;
    relocate(state, potion.cardRef, "hand:1");
    state = attack(state, 2);
    state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
    state = passAttack(state, "dying-source-pass");
    const blocked = runCombatUntilBlocked(state, ruleset, () => 1000);
    expect(blocked.stoppedReason).toBe("dyingWindow");
    expect(
      (blocked.state.combat.attack as Record<string, JsonValue>)
        .pendingOwlTrigger,
    ).toBeDefined();
    expect(
      blocked.state.pendingWindows.some(
        (window) => window.kind === "owlCounterattack",
      ),
    ).toBe(false);
    const rescue = new DyingCommandSession(blocked.state, () => 1000),
      window = rescue.state.pendingWindows[0]!;
    rescue.handle({
      commandId: "rescue-owl",
      gameId: rescue.state.gameId,
      expectedStateRevision: rescue.state.stateRevision,
      actorUserId: "u1",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((offer) =>
        offer.includes(":rescue:"),
      )!,
      cardRef: potion.cardRef,
    });
    expect(rescue.state.players[1]!.lifeState).toBe("alive");
    expect(
      (rescue.state.combat.attack as Record<string, JsonValue>).status,
    ).toBe("awaitingOwlTrigger");
    const resumed = runCombatUntilBlocked(rescue.state, ruleset, () => 1000);
    expect(resumed.state.pendingWindows[0]).toMatchObject({
      kind: "owlCounterattack",
      prioritySeat: 2,
    });
    const owl = new OwlSession(resumed.state, ruleset),
      owlWindow = owl.state.pendingWindows[0]!;
    owl.handle({
      commandId: "rescued-owl-attack",
      gameId: owl.state.gameId,
      expectedStateRevision: owl.state.stateRevision,
      actorUserId: "u2",
      promptId: owlWindow.promptId,
      offerId: owlWindow.legalOfferIds.find((offer) =>
        offer.startsWith("offer:owl:attack:"),
      )!,
    });
    expect(
      owl.state.pendingWindows.some(
        (candidate) => candidate.kind === "playPhaseAction",
      ),
    ).toBe(false);
    expect(owl.state.combat.attack).toMatchObject({
      attackerSeat: 2,
      modeId: "blowDart",
    });
    expect(
      (owl.state.combat.attack as Record<string, JsonValue>).continuationQueue,
    ).toHaveLength(1);
  });
});
