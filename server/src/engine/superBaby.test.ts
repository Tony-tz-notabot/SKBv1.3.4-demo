import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import { DyingCommandSession, openDyingRescue } from "./dying.js";
import { resolvePhaseBody } from "./phaseBody.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { SuperBabyResponseSession, SuperBabyUseSession } from "./superBaby.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function relocate(
  state: AuthoritativeGameState,
  ref: string,
  toZoneRef: string,
) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[toZoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  target.orderedCardRefs.push(ref);
  Object.assign(card, {
    zoneRef: toZoneRef,
    ownerSeat: target.ownerSeat,
    controllerSeat: target.ownerSeat,
    faceUp: !toZoneRef.startsWith("hand:"),
  });
}
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "super-baby",
    firstSeat: 1,
    seed: 909,
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
  const card = Object.values(state.cards).find(
    (item) => item.templateId === "special.sp09",
  )!;
  relocate(state, card.cardRef, "hand:1");
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:super-baby",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, cardRef: card.cardRef };
}
function use(prepared: ReturnType<typeof ready>) {
  const session = new SuperBabyUseSession(prepared.state, ruleset),
    command = {
      commandId: "super-baby-use",
      gameId: prepared.state.gameId,
      expectedStateRevision: prepared.state.stateRevision,
      actorUserId: "u1",
      promptId: "play:super-baby",
      offerId: `offer:special.sp09:${prepared.cardRef}`,
      cardRef: prepared.cardRef,
    },
    result = session.handle(command);
  expect(session.handle(command)).toEqual(result);
  return session.state;
}
function enterJudgment(state: AuthoritativeGameState) {
  state.pendingWindows = [];
  state.phase = "judgment";
  state.phaseBoundary = "body";
  state.phaseMode = "automatic";
  state.phaseBodyResolved = false;
  return resolvePhaseBody(state, ruleset, 1000).state;
}
function respond(
  session: SuperBabyResponseSession,
  offerId?: string,
  id = "response",
) {
  const window = session.state.pendingWindows[0]!,
    actor = session.state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
  return session.handle({
    commandId: `${id}:${actor.seat}`,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId:
      offerId ??
      window.legalOfferIds.find((candidate) => candidate.endsWith(":pass"))!,
  });
}

describe("Super Baby", () => {
  it("enters the owner's judgment zone with a persistent source", () => {
    const prepared = ready(),
      state = use(prepared);
    expect(state.cards[prepared.cardRef]).toMatchObject({
      zoneRef: "judgment:1",
      runtime: { persistentSourceSeat: 1 },
    });
    expect(state.pendingWindows[0]).toMatchObject({ kind: "playPhaseAction" });
  });

  it("collects all special dodges before hp damage, then resolves fire and poison per other target", () => {
    const prepared = ready();
    for (const player of prepared.state.players) {
      player.hp = 10;
      player.maxHp = 10;
      player.shield = 10;
      player.maxShield = 10;
      player.initialTalentIds = [];
    }
    const dodge = Object.values(prepared.state.cards).find((card) =>
      card.templateId.startsWith("basic.dodge."),
    )!;
    relocate(prepared.state, dodge.cardRef, "hand:1");
    let state = enterJudgment(use(prepared));
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "superBabyDodgeRequest",
      prioritySeat: 1,
    });
    const responses = new SuperBabyResponseSession(state, ruleset, () => 1000),
      firstWindow = responses.state.pendingWindows[0]!,
      dodgeOffer = firstWindow.legalOfferIds.find((id) =>
        id.includes(":play:"),
      )!;
    respond(responses, dodgeOffer, "dodge");
    respond(responses, undefined, "pass");
    respond(responses, undefined, "pass");
    respond(responses, undefined, "pass");
    state = responses.state;
    expect(state.players.map((player) => player.hp)).toEqual([10, 10, 10, 10]);
    expect(state.scheduledEffects).toHaveLength(4);
    while (state.scheduledEffects.length)
      state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.players.map((player) => player.hp)).toEqual([10, 7, 7, 7]);
    expect(state.players.map((player) => player.shield)).toEqual([10, 8, 8, 8]);
    expect(state.cards[prepared.cardRef]!.zoneRef).toBe("discardPile");
    expect(state.phaseBodyResolved).toBe(true);
  });

  it("pauses between hp targets for dying and builds the elemental target list only afterward", () => {
    const prepared = ready();
    for (const player of prepared.state.players) {
      player.hp = 10;
      player.maxHp = 10;
      player.shield = 0;
      player.maxShield = 10;
      player.initialTalentIds = [];
    }
    prepared.state.players[1]!.hp = 2;
    let state = enterJudgment(use(prepared));
    const responses = new SuperBabyResponseSession(state, ruleset, () => 1000);
    for (let index = 0; index < 4; index += 1)
      respond(responses, undefined, `all-pass:${index}`);
    state = responses.state;
    state = executeNextImmediateDamageEffect(state, ruleset).state;
    state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.players[1]!.lifeState).toBe("dying");
    expect(state.scheduledEffects.length).toBeGreaterThan(0);
    state = openDyingRescue(state, 1000, ruleset).state;
    const dying = new DyingCommandSession(state, () => 1000);
    for (let index = 0; index < 4; index += 1) {
      const window = dying.state.pendingWindows[0]!,
        actor = dying.state.players.find(
          (player) => player.seat === window.prioritySeat,
        )!;
      dying.handle({
        commandId: `dying-pass:${index}`,
        gameId: dying.state.gameId,
        expectedStateRevision: dying.state.stateRevision,
        actorUserId: actor.userId,
        promptId: window.promptId,
        offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))!,
      });
    }
    state = dying.state;
    expect(state.players[1]!.lifeState).toBe("eliminated");
    while (state.scheduledEffects.length)
      state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(
      state.history.domainEvents.some(
        (event) =>
          event.eventType === "effect.stage.started" &&
          JSON.stringify(event.payload).includes("character:2"),
      ),
    ).toBe(false);
  });

  it("does not trigger after the delayed card was dismantled before judgment", () => {
    const prepared = ready(),
      state = use(prepared);
    relocate(state, prepared.cardRef, "discardPile");
    const entered = enterJudgment(state);
    expect(entered.pendingWindows).toHaveLength(0);
    expect(entered.phaseBodyResolved).toBe(true);
  });
});
