import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import { copyTemporaryCardToHandInTransaction } from "./generatedCards.js";
import { InternetAddictionSession } from "./internetAddiction.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { expireSheepDodgeLocksAtTurnEnd, SheepSession } from "./sheep.js";
import { specialPlayOffers } from "./specialCardPlay.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "sheep",
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
  const tx = new EngineTransaction(state),
    cardRef = copyTemporaryCardToHandInTransaction(tx, {
      templateId: "special.sp03",
      ownerSeat: 1,
      sourceRef: "synthesis:test",
      generatedBy: "synthesis.special.sp03",
      exitZoneRef: "outsideDeck",
    }),
    committed = tx.commit();
  state = committed.state;
  state.history.domainEvents.push(...committed.events);
  for (const player of state.players) {
    player.hp = 10;
    player.maxHp = 10;
    player.shield = 10;
    player.maxShield = 10;
    player.initialTalentIds = [];
  }
  Object.assign(state, {
    activeSeat: 1,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  state.pendingWindows = [
    {
      promptId: "play:sheep",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, cardRef };
}
function use(prepared: ReturnType<typeof ready>) {
  const session = new SheepSession(prepared.state, ruleset, () => 1000),
    command = {
      commandId: "sheep-use",
      gameId: prepared.state.gameId,
      expectedStateRevision: prepared.state.stateRevision,
      actorUserId: "u1",
      promptId: "play:sheep",
      offerId: `offer:special.sp03:${prepared.cardRef}`,
      cardRef: prepared.cardRef,
    },
    result = session.handle(command);
  expect(result.accepted).toBe(true);
  expect(session.handle(command)).toEqual(result);
  return session;
}
function passSheep(session: SheepSession, id: string) {
  const window = session.state.pendingWindows[0]!,
    actor = session.state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
  return session.handle({
    commandId: id,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.endsWith(":pass"))!,
    cardRef: String(window.context!.cardRef),
  });
}
function passInternet(session: InternetAddictionSession, id: string) {
  const window = session.state.pendingWindows[0]!,
    actor = session.state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
  return session.handle({
    commandId: id,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.endsWith(":pass"))!,
    cardRef: String(window.context!.cardRef),
  });
}

describe("Sheep two-stage effect", () => {
  it("finishes phase-one consequences before opening an independent Internet-addiction phase", () => {
    const prepared = ready(),
      sheep = use(prepared);
    passSheep(sheep, "s2");
    passSheep(sheep, "s3");
    passSheep(sheep, "s4");
    let state = sheep.state;
    expect(state.scheduledEffects).toHaveLength(4);
    expect(state.pendingWindows).toHaveLength(0);
    for (let index = 0; index < 3; index += 1)
      state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.players.map((player) => player.shield)).toEqual([10, 8, 8, 8]);
    expect(
      state.players
        .slice(1)
        .every((player) => player.markers.cannotDodgeUntilTurnEnd === true),
    ).toBe(true);
    expect(specialPlayOffers(state, ruleset, 2, "dodge", "test")).toEqual([]);
    state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "internetAddictionDodgeRequest",
      prioritySeat: 2,
    });
    expect(
      state.history.domainEvents.some(
        (event) =>
          event.eventType === "effect.stage.started" &&
          JSON.stringify(event.payload).includes("nestedInternetAddiction"),
      ),
    ).toBe(true);
    const internet = new InternetAddictionSession(state, ruleset, () => 1000);
    passInternet(internet, "i2");
    passInternet(internet, "i3");
    passInternet(internet, "i4");
    state = internet.state;
    while (state.scheduledEffects.length)
      state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.players.map((player) => player.shield)).toEqual([10, 5, 5, 5]);
    expect(state.cards[prepared.cardRef]!.zoneRef).toBe("outsideDeck");
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
    });
  });

  it("pauses phase one for dying before phase two can start", () => {
    const prepared = ready();
    prepared.state.players[1]!.shield = 0;
    prepared.state.players[1]!.hp = 1;
    const sheep = use(prepared);
    passSheep(sheep, "d2");
    passSheep(sheep, "d3");
    passSheep(sheep, "d4");
    const state = executeNextImmediateDamageEffect(sheep.state, ruleset).state;
    expect(state.players[1]).toMatchObject({
      lifeState: "dying",
      markers: { cannotDodgeUntilTurnEnd: true },
    });
    expect(
      state.scheduledEffects.some(
        (effect) =>
          (effect.effect as { op?: string }).op === "startSheepPhaseTwo",
      ),
    ).toBe(true);
    expect(() => executeNextImmediateDamageEffect(state, ruleset)).toThrow(
      "DIRECT_DAMAGE_NOT_STABLE",
    );
  });

  it("expires every phase-one Dodge lock at the current turn end boundary", () => {
    const prepared = ready(),
      tx = new EngineTransaction(prepared.state);
    for (const player of tx.draft.players.slice(1)) {
      player.markers.cannotDodgeUntilTurnEnd = true;
      tx.draft.durations.push({
        durationId: `duration:sheep-dodge-lock:test:${player.seat}`,
        sourceRef: prepared.cardRef,
        ownerRef: `character:${player.seat}`,
        anchorEventId: null,
        activationPoint: "test",
        expiryPoint: "currentTurn.end",
        remainingCount: null,
        countScope: "globalTurn",
        skipPolicy: "expireOnSkippedBoundary",
        sourceLeavePolicy: "continue",
        ownerEliminatedPolicy: "cancel",
        cleanupEffects: [],
      });
    }
    expireSheepDodgeLocksAtTurnEnd(tx);
    expect(
      tx.draft.players
        .slice(1)
        .every(
          (player) => player.markers.cannotDodgeUntilTurnEnd === undefined,
        ),
    ).toBe(true);
    expect(
      tx.draft.durations.some((duration) =>
        duration.durationId.startsWith("duration:sheep-dodge-lock:"),
      ),
    ).toBe(false);
  });
});
