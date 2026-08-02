import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitStandardPersistentBossUse } from "./bossUse.js";
import { commitC6FocusedBombardment, commitC6LaserSweep } from "./c6h8o6.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { copyTemporaryCardToHandInTransaction } from "./generatedCards.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { ValkyrieResponseSession } from "./valkyrie.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(state: AuthoritativeGameState, ref: string, to: string) {
  const card = state.cards[ref]!;
  state.zones[card.zoneRef]!.orderedCardRefs.splice(
    state.zones[card.zoneRef]!.orderedCardRefs.indexOf(ref),
    1,
  );
  state.zones[to]!.orderedCardRefs.push(ref);
  card.zoneRef = to;
  card.ownerSeat = state.zones[to]!.ownerSeat;
  card.controllerSeat = state.zones[to]!.ownerSeat;
  card.faceUp = !["drawPile", "hand"].includes(state.zones[to]!.zoneType);
}

function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "valkyrie",
    firstSeat: 1,
    seed: 347,
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
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["finish"],
      context: {},
    },
  ];
  const slime = Object.values(state.cards).find(
      (card) => card.templateId === "boss.giant_slime",
    )!.cardRef,
    valkyrie = Object.values(state.cards).find(
      (card) => card.templateId === "boss.valkyrie",
    )!.cardRef;
  relocate(state, slime, "hand:1");
  relocate(state, valkyrie, "hand:2");
  return { state, slime, valkyrie };
}

function answer(session: ValkyrieResponseSession, seat: Seat, use: boolean) {
  const window = session.state.pendingWindows[0]!,
    offerId = window.legalOfferIds.find((id) =>
      id.includes(use ? ":use:" : ":pass:"),
    )!,
    cardRef = use ? offerId.split(":use:")[1] : undefined;
  return session.handle({
    commandId: `response-${seat}-${use}`,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: `u${seat}`,
    promptId: window.promptId,
    offerId,
    ...(cardRef ? { cardRef } : {}),
  });
}

describe("Valkyrie boss response", () => {
  it("responds after the original cost and before immediate activation", () => {
    const { state, slime, valkyrie } = ready(),
      committed = commitStandardPersistentBossUse(state, ruleset, {
        actorSeat: 1,
        cardRef: slime,
      });
    expect(committed.state.cards[slime]!.runtime).toMatchObject({
      active: false,
      pendingValkyrieResponses: true,
    });
    expect(committed.state.pendingWindows[0]).toMatchObject({
      kind: "valkyrieBossResponse",
      prioritySeat: 2,
    });
    expect(
      committed.state.pendingWindows.some((w) => w.kind === "playPhaseAction"),
    ).toBe(false);
    const session = new ValkyrieResponseSession(committed.state, ruleset);
    expect(answer(session, 2, true).accepted).toBe(true);
    const copy = Object.values(session.state.cards).find(
      (card) =>
        card.templateId === "boss.giant_slime" &&
        card.runtime.generatedBy === "boss.valkyrie",
    )!;
    expect(copy).toMatchObject({ zoneRef: "hand:2" });
    expect(session.state.cards[valkyrie]!.zoneRef).toBe("discardPile");
    expect(session.state.cards[slime]!.runtime).toMatchObject({
      active: true,
      specialLayerRemaining: 5,
    });
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
      deadlineAt: 900,
    });
  });

  it("does not offer a responder whose boss quota is already occupied", () => {
    const { state, slime } = ready();
    state.players[1]!.markers["boss.lastUsedGlobalTurn"] =
      `${state.round}:${state.activeSeat}`;
    const committed = commitStandardPersistentBossUse(state, ruleset, {
      actorSeat: 1,
      cardRef: slime,
    });
    expect(committed.state.pendingWindows[0]!.kind).toBe("playPhaseAction");
    expect(committed.state.cards[slime]!.runtime.active).toBe(true);
  });

  it("resolves multiple accepted responses last-in-first-out", () => {
    const { state, slime } = ready(),
      tx = new EngineTransaction(state);
    copyTemporaryCardToHandInTransaction(tx, {
      templateId: "boss.valkyrie",
      ownerSeat: 3,
      sourceRef: "test:valkyrie-copy",
      generatedBy: "test",
    });
    const made = tx.commit();
    made.state.history.domainEvents.push(...made.events);
    const withSecond = made.state,
      committed = commitStandardPersistentBossUse(withSecond, ruleset, {
        actorSeat: 1,
        cardRef: slime,
      }),
      session = new ValkyrieResponseSession(committed.state, ruleset);
    answer(session, 2, true);
    answer(session, 3, true);
    expect(
      session.state.history.domainEvents
        .filter((event) => event.eventType === "boss.valkyrie.resolved")
        .map((event) =>
          Number((event.payload as Record<string, unknown>).seat),
        ),
    ).toEqual([3, 2]);
  });

  it("copies C6 after its attack-count cost, then resumes the selected branch", () => {
    const { state, valkyrie } = ready(),
      c6 = Object.values(state.cards).find(
        (card) => card.templateId === "boss.c6h8o6",
      )!.cardRef;
    relocate(state, c6, "hand:1");
    state.players[0]!.limits[ruleset.settings.combat.attackCountLimitId] = 1;
    const committed = commitC6LaserSweep(state, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "kill",
        deadlineAt: 900,
      }),
      session = new ValkyrieResponseSession(committed.state, ruleset);
    expect(committed.state.pendingWindows[0]!.kind).toBe(
      "valkyrieBossResponse",
    );
    answer(session, 2, true);
    expect(session.state.cards[valkyrie]!.zoneRef).toBe("discardPile");
    expect(
      Object.values(session.state.cards).some(
        (card) =>
          card.templateId === "boss.c6h8o6" &&
          card.zoneRef === "hand:2" &&
          card.runtime.generatedBy === "boss.valkyrie",
      ),
    ).toBe(true);
    const resumed = runAutomaticScheduler(session.state, ruleset, () => 900);
    expect(resumed.state.pendingWindows[0]).toMatchObject({
      kind: "c6LaserSweepRequest",
      prioritySeat: 2,
      context: { family: "kill" },
    });
  });

  it("copies only the C6 template while focused-bombardment choices stay on the original", () => {
    const { state } = ready(),
      c6 = Object.values(state.cards).find(
        (card) => card.templateId === "boss.c6h8o6",
      )!.cardRef;
    relocate(state, c6, "hand:1");
    state.players[0]!.limits[ruleset.settings.combat.attackCountLimitId] = 1;
    const committed = commitC6FocusedBombardment(state, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "dodge",
        targetSeat: 2,
      }),
      session = new ValkyrieResponseSession(committed.state, ruleset);
    answer(session, 2, true);
    const copy = Object.values(session.state.cards).find(
      (card) =>
        card.templateId === "boss.c6h8o6" &&
        card.zoneRef === "hand:2" &&
        card.runtime.generatedBy === "boss.valkyrie",
    )!;
    expect(copy.runtime).not.toHaveProperty("modeId");
    expect(copy.runtime).not.toHaveProperty("targetSeat");
    expect(copy.runtime).not.toHaveProperty("requestedFamily");
    expect(session.state.cards[c6]).toMatchObject({
      zoneRef: "boss:1",
      runtime: {
        modeId: "focusedBombardment",
        targetSeat: 2,
        requestedFamily: "dodge",
        triggered: false,
      },
    });
    const resumed = runAutomaticScheduler(session.state, ruleset, () => 900);
    expect(resumed.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
      deadlineAt: 900,
    });
  });
});
