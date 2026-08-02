import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import {
  applyDirectDamageInTransaction,
  resolveCurrentAttackTarget,
} from "./damage.js";
import { DyingCommandSession, openDyingRescue } from "./dying.js";
import { setWeaponPreselection } from "./preselection.js";
import { AttackResponseSession, openAttackResponse } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";

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

function hitSlime() {
  let state = createInitialSetup(ruleset, {
    gameId: "giant-slime",
    firstSeat: 1,
    seed: 313,
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
  state.phaseMode = "manual";
  state.players[0]!.limits.attackCountRemaining = 1;
  const kill = Object.values(state.cards).find((card) =>
      card.templateId.startsWith("basic.kill."),
    )!.cardRef,
    slime = Object.values(state.cards).find(
      (card) => card.templateId === "boss.giant_slime",
    )!.cardRef;
  relocate(state, kill, "hand:1");
  relocate(state, slime, "boss:2");
  state.cards[slime]!.runtime = {
    active: true,
    activationStatus: "active",
    specialLayerId: "giantSlime.temporaryHp",
    specialLayerRemaining: 5,
    specialLayerRecoverable: false,
  };
  state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
  state = commitAttack(state, ruleset, {
    attackerSeat: 1,
    targetRefs: ["character:2"],
    killCardRefs: [kill],
  }).state;
  state = openAttackResponse(state, ruleset, 500).state;
  const response = state.pendingWindows[0]!,
    session = new AttackResponseSession(state);
  session.handle({
    commandId: "pass",
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u2",
    promptId: response.promptId,
    offerId: response.legalOfferIds.find((id) => id.includes(":pass:"))!,
  });
  return { state: session.state, slime };
}

describe("Giant Slime temporary health", () => {
  it("absorbs eligible damage without overflow, leaves, then deals five self field damage", () => {
    const { state, slime } = hitSlime(),
      target = state.players[1]!,
      attack = state.combat.attack as Record<string, unknown>;
    target.shield = 10;
    target.hp = 10;
    attack.damageSegments = [
      {
        segmentId: "heavy",
        damageType: "normal",
        element: "none",
        amount: 8,
        repeat: 1,
      },
    ];
    const result = resolveCurrentAttackTarget(state, ruleset);
    expect(result.state.cards[slime]!.zoneRef).toBe("discardPile");
    expect(result.state.players[1]).toMatchObject({ shield: 5, hp: 10 });
    expect(
      result.events.find((event) => event.eventType === "specialLayer.lost")
        ?.payload,
    ).toMatchObject({ amount: 5, remaining: 0 });
    expect(
      result.events.find(
        (event) =>
          event.eventType === "boss.effect.resolved" &&
          (event.payload as Record<string, unknown>).modeId ===
            "temporaryLayerBacklash",
      )?.payload,
    ).toMatchObject({ targetSeat: 2, actualDamage: 5 });
  });

  it("shield damage bypasses the layer", () => {
    const { state, slime } = hitSlime(),
      tx = new EngineTransaction(state);
    tx.draft.combat.attack = null;
    tx.draft.combat.targetQueue = [];
    tx.draft.combat.currentTargetRef = null;
    tx.draft.players[1]!.shield = 10;
    applyDirectDamageInTransaction(tx, {
      damageId: "damage:shield-only",
      sourceSeat: 1,
      targetRef: "character:2",
      amount: 3,
      damageType: "shield",
      element: "none",
      isAdditional: false,
      ruleset,
    });
    expect(tx.draft.cards[slime]!.runtime.specialLayerRemaining).toBe(5);
    expect(tx.draft.players[1]!.shield).toBe(7);
  });

  it("pauses remaining segments for backlash dying and resumes them only after rescue", () => {
    const { state } = hitSlime(),
      target = state.players[1]!,
      attack = state.combat.attack as Record<string, unknown>;
    target.shield = 0;
    target.hp = 3;
    attack.damageSegments = [
      {
        segmentId: "multi",
        damageType: "normal",
        element: "none",
        amount: 5,
        repeat: 2,
      },
    ];
    let current = resolveCurrentAttackTarget(state, ruleset).state;
    expect(current.combat.attack).toMatchObject({
      status: "awaitingSegmentDying",
      pendingDamageOccurrences: [expect.any(Object)],
    });
    const potion = Object.values(current.cards).find((card) =>
      card.templateId.startsWith("basic.potion."),
    )!.cardRef;
    relocate(current, potion, "hand:1");
    current = openDyingRescue(current, 700, ruleset).state;
    const window = current.pendingWindows[0]!,
      rescue = new DyingCommandSession(current, () => 700);
    rescue.handle({
      commandId: "rescue",
      gameId: current.gameId,
      expectedStateRevision: current.stateRevision,
      actorUserId: `u${window.prioritySeat}`,
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((id) => id.includes(":rescue:"))!,
      cardRef: potion,
    });
    expect(rescue.state.combat.attack).toMatchObject({ status: "targetHit" });
    const resumed = resolveCurrentAttackTarget(rescue.state, ruleset);
    expect(
      resumed.events.some(
        (event) =>
          event.eventType === "damage.proposed" &&
          (event.payload as Record<string, unknown>).repeatIndex === 1,
      ),
    ).toBe(true);
  });
});
