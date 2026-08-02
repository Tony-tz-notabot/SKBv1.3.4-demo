import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { onBossOwnerTurnStart, onBossTurnEnd } from "./bossLifecycle.js";
import { commitStandardPersistentBossUse } from "./bossUse.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { advanceTimeline } from "./timeline.js";
import { EngineTransaction } from "./transaction.js";
import { moveCard } from "./zones.js";
let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = {
    1: "character.knight",
    2: "character.alchemist",
    3: "character.ranger",
    4: "character.wizard",
  } as const;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function started() {
  let state = createInitialSetup(ruleset, {
    gameId: "boss-life",
    firstSeat: 1,
    seed: 157,
    usersBySeat: users,
    characterIdsBySeat: characters,
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
      deadlineAt: 500,
      timeoutPolicy: "pass",
      legalOfferIds: ["finish"],
      context: {},
    },
  ];
  return state;
}
function refFor(state: AuthoritativeGameState, id: string) {
  return Object.values(state.cards).find((card) => card.templateId === id)!
    .cardRef;
}
function relocate(state: AuthoritativeGameState, ref: string, to: string) {
  const card = state.cards[ref]!,
    from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  state.zones[to]!.orderedCardRefs.push(ref);
  card.zoneRef = to;
  card.ownerSeat = state.zones[to]!.ownerSeat;
  card.controllerSeat = state.zones[to]!.ownerSeat;
  card.faceUp = state.zones[to]!.zoneType !== "hand";
}
function use(id: string) {
  const state = started(),
    ref = refFor(state, id);
  relocate(state, ref, "hand:1");
  const used = commitStandardPersistentBossUse(state, ruleset, {
    actorSeat: 1,
    cardRef: ref,
  }).state;
  used.pendingWindows = [];
  return { state: used, ref };
}
describe("persistent boss lifecycle anchors", () => {
  it("activates Purple Lord at the use-turn end phase start and cleans every contribution at next owner end", () => {
    let { state, ref } = use("boss.purple_lord");
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.cards[ref]!.runtime.active).toBe(true);
    expect(state.players[0]).toMatchObject({
      ironShield: 1,
      markers: {
        equipmentEffectsDisabled: true,
        equipmentDisableSources: [ref],
        bossControlImmunitySources: [ref],
      },
    });
    expect(
      state.players[0]!.statuses.some(
        (status) =>
          status.statusId === "status.stasis" && status.sourceRef === ref,
      ),
    ).toBe(true);
    state.phase = "discard";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state.activeSeat = 1;
    state.cards[ref]!.runtime.ownerTurnOrdinal = 1;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.cards[ref]!.zoneRef).toBe("discardPile");
    expect(state.players[0]!.ironShield).toBe(0);
    expect(state.players[0]!.markers.equipmentEffectsDisabled).toBeUndefined();
    expect(
      state.players[0]!.statuses.some((status) => status.sourceRef === ref),
    ).toBe(false);
  });
  it("initializes Red Lord's frozen counter when it activates", () => {
    let { state, ref } = use("boss.red_lord");
    state.phase = "discard";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.cards[ref]!.runtime).toMatchObject({
      active: true,
      "redLord.actualPositiveDamageCount": 0,
      ownerTurnOrdinal: 0,
    });
  });
  it("activates Crystal Crab at turn end, heals on each replaced owner turn, and expires after the second", () => {
    let { state, ref } = use("boss.crystal_crab");
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.cards[ref]!.runtime.active).toBe(true);
    expect(state.players[0]!.ironShield).toBe(1);
    state.players[0]!.hp = Math.max(1, state.players[0]!.maxHp! - 2);
    for (let ordinal = 1; ordinal <= 2; ordinal++) {
      state.round += 1;
      state.activeSeat = 1;
      const tx = new EngineTransaction(state);
      onBossOwnerTurnStart(tx, ruleset, 1);
      state = tx.commit().state;
      expect(state.cards[ref]!.runtime.ownerTurnOrdinal).toBe(ordinal);
    }
    expect(state.players[0]!.hp).toBe(state.players[0]!.maxHp);
    const endTx = new EngineTransaction(state);
    onBossTurnEnd(endTx, ruleset, 1);
    state = endTx.commit().state;
    expect(state.cards[ref]!.zoneRef).toBe("discardPile");
    expect(state.players[0]!.ironShield).toBe(0);
  });
  it("activates Giant Slime immediately at successful use commit", () => {
    const { state, ref } = use("boss.giant_slime");
    expect(state.cards[ref]!.runtime).toMatchObject({
      active: true,
      activationStatus: "active",
      activatedAtPoint: "card.use.committed",
      specialLayerId: "giantSlime.temporaryHp",
      specialLayerRemaining: 5,
      specialLayerRecoverable: false,
    });
  });
  it("cleans active contributions and cancels uncreated effects on external dismantle", () => {
    let { state, ref } = use("boss.purple_lord");
    state.phase = "discard";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    state.scheduledEffects.push({
      scheduledId: "scheduled:purple",
      sourceRef: ref,
      controllerSeat: 1,
      executeAt: "future",
      effect: { op: "test" },
      cancelled: false,
    });
    const removed = moveCard(state, {
      cardRef: ref,
      toZoneRef: "discardPile",
      moveKind: "dismantle",
    });
    expect(removed.state.players[0]!.ironShield).toBe(0);
    expect(
      removed.state.players[0]!.markers.equipmentEffectsDisabled,
    ).toBeUndefined();
    expect(
      removed.state.players[0]!.statuses.some(
        (status) => status.sourceRef === ref,
      ),
    ).toBe(false);
    expect(removed.state.scheduledEffects[0]!.cancelled).toBe(true);
    expect(removed.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["boss.expired", "effect.cancelled", "card.lost"]),
    );
  });
});
