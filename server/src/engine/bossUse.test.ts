import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  BossUseCommandSession,
  commitStandardPersistentBossUse,
  legalStandardPersistentBossCards,
} from "./bossUse.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
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
    gameId: "boss-use",
    firstSeat: 1,
    seed: 149,
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
      promptId: "prompt:play",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 500,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:finish"],
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
describe("standard persistent boss use boundary", () => {
  it("atomically uses a persistent Boss from hand and consumes the current global-turn quota", () => {
    const state = started(),
      boss = refFor(state, "boss.purple_lord");
    relocate(state, boss, "hand:1");
    const result = commitStandardPersistentBossUse(state, ruleset, {
      actorSeat: 1,
      cardRef: boss,
    });
    expect(result.state.cards[boss]).toMatchObject({
      zoneRef: "boss:1",
      ownerSeat: 1,
      controllerSeat: 1,
      faceUp: true,
      runtime: { activationStatus: "pending", active: false },
    });
    expect(result.state.players[0]!.markers["boss.lastUsedGlobalTurn"]).toBe(
      "1:1",
    );
    expect(result.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "boss.use.declared",
        "card.moved",
        "boss.use.committed",
      ]),
    );
  });
  it("rejects a second Boss in the same global turn without mutating state", () => {
    let state = started(),
      first = refFor(state, "boss.purple_lord"),
      second = refFor(state, "boss.red_lord");
    relocate(state, first, "hand:1");
    relocate(state, second, "hand:1");
    state = commitStandardPersistentBossUse(state, ruleset, {
      actorSeat: 1,
      cardRef: first,
    }).state;
    const revision = state.stateRevision;
    expect(() =>
      commitStandardPersistentBossUse(state, ruleset, {
        actorSeat: 1,
        cardRef: second,
      }),
    ).toThrow("BOSS_USE_LIMIT_REACHED");
    expect(state.stateRevision).toBe(revision);
    expect(state.cards[second]!.zoneRef).toBe("hand:1");
  });
  it("only permits replacing a pre-death Iron Pirate and moves both cards in one commit", () => {
    const state = started(),
      iron = refFor(state, "boss.iron_pirate_king"),
      next = refFor(state, "boss.crystal_crab");
    relocate(state, iron, "boss:1");
    relocate(state, next, "hand:1");
    const result = commitStandardPersistentBossUse(state, ruleset, {
      actorSeat: 1,
      cardRef: next,
    });
    expect(result.state.cards[iron]!.zoneRef).toBe("discardPile");
    expect(result.state.cards[next]!.zoneRef).toBe("boss:1");
    expect(
      result.events.find((event) => event.eventType === "boss.use.committed")
        ?.payload,
    ).toMatchObject({ replacedCardRef: iron });
  });
  it("blocks occupied ordinary slots and post-death Iron Pirate replacement", () => {
    const occupied = started(),
      purple = refFor(occupied, "boss.purple_lord"),
      red = refFor(occupied, "boss.red_lord");
    relocate(occupied, purple, "boss:1");
    relocate(occupied, red, "hand:1");
    expect(() =>
      commitStandardPersistentBossUse(occupied, ruleset, {
        actorSeat: 1,
        cardRef: red,
      }),
    ).toThrow("BOSS_SLOT_OCCUPIED");
    const dead = started(),
      iron = refFor(dead, "boss.iron_pirate_king"),
      crab = refFor(dead, "boss.crystal_crab");
    relocate(dead, iron, "boss:1");
    relocate(dead, crab, "hand:1");
    dead.players[0]!.lifeState = "deadNotEliminated";
    dead.players[0]!.hp = null;
    dead.players[0]!.shield = null;
    expect(() =>
      commitStandardPersistentBossUse(dead, ruleset, {
        actorSeat: 1,
        cardRef: crab,
      }),
    ).toThrow("BOSS_SLOT_OCCUPIED");
  });
  it("offers only standard persistent legal cards and keeps commands idempotent", () => {
    const state = started(),
      purple = refFor(state, "boss.purple_lord"),
      valkyrie = refFor(state, "boss.valkyrie"),
      c6 = refFor(state, "boss.c6h8o6");
    for (const ref of [purple, valkyrie, c6]) relocate(state, ref, "hand:1");
    expect(legalStandardPersistentBossCards(state, ruleset, 1)).toEqual([
      purple,
    ]);
    const session = new BossUseCommandSession(state, ruleset),
      command = {
        commandId: "boss-use",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u1",
        promptId: "prompt:play",
        cardRef: purple,
      };
    const first = session.handle(command),
      again = session.handle(command);
    expect(first.accepted).toBe(true);
    expect(again).toEqual(first);
    expect(session.state.stateRevision).toBe(
      (first as { stateRevision: number }).stateRevision,
    );
  });
});
