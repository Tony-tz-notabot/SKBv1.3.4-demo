import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import { DyingCommandSession, openDyingRescue } from "./dying.js";
import { setWeaponPreselection } from "./preselection.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

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
    from = state.zones[card.zoneRef]!,
    to = state.zones[toZoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  to.orderedCardRefs.push(ref);
  card.zoneRef = toZoneRef;
  card.ownerSeat = to.ownerSeat;
  card.controllerSeat = to.ownerSeat;
  card.faceUp = !toZoneRef.startsWith("hand:");
}

function ready(killPrefix = "basic.kill.red") {
  let state = createInitialSetup(ruleset, {
    gameId: "blood-curse",
    firstSeat: 1,
    seed: 5011,
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
  state.activeSeat = 1;
  state.round = 3;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:blood-curse",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  state.players[0]!.limits.attackCountRemaining = 1;
  state.players[0]!.markers.bloodCurseEnabled = true;
  const weapon = Object.values(state.cards).find((card) =>
      card.templateId.startsWith("weapon.w01"),
    )!,
    kill = Object.values(state.cards).find((card) =>
      card.templateId.startsWith(killPrefix),
    )!;
  relocate(state, weapon.cardRef, "weapon:1:1");
  relocate(state, kill.cardRef, "hand:1");
  state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
  return { state, kill: kill.cardRef };
}

describe("Blood Curse", () => {
  it("pays costs, deals configured field damage, then resumes the original attack before response", () => {
    const prepared = ready();
    prepared.state.players[1]!.shield = 3;
    const paid = commitAttack(prepared.state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [prepared.kill],
    });
    expect(paid.state.combat.attack).toBeNull();
    expect(paid.state.players[0]!.limits.attackCountRemaining).toBe(0);
    expect(paid.state.cards[prepared.kill]!.zoneRef).toBe("resolving");
    expect(paid.state.scheduledEffects).toHaveLength(2);

    const damaged = executeNextImmediateDamageEffect(paid.state, ruleset);
    expect(damaged.state.players[1]!.shield).toBe(1);
    expect(damaged.state.combat.attack).toBeNull();
    const resumed = executeNextImmediateDamageEffect(damaged.state, ruleset);
    expect(resumed.state.combat.attack).toMatchObject({
      attackerSeat: 1,
      status: "committed",
      killCardRefs: [prepared.kill],
    });
    expect(resumed.events.map((event) => event.eventType)).toContain(
      "attack.killInvalidation.check",
    );
  });

  it("runs before Kill invalidation and keeps both costs paid when Shield invalidates the attack", () => {
    const prepared = ready("basic.kill.white"),
      armor = Object.values(prepared.state.cards).find(
        (card) => card.templateId === "armor.a04",
      )!;
    relocate(prepared.state, armor.cardRef, "armor:2");
    prepared.state.players[1]!.shield = 4;
    const paid = commitAttack(prepared.state, ruleset, {
        attackerSeat: 1,
        targetRefs: ["character:2"],
        killCardRefs: [prepared.kill],
      }),
      damaged = executeNextImmediateDamageEffect(paid.state, ruleset),
      invalidated = executeNextImmediateDamageEffect(damaged.state, ruleset);
    expect(damaged.state.players[1]!.shield).toBe(2);
    expect(invalidated.state.combat.attack).toBeNull();
    expect(invalidated.state.cards[prepared.kill]!.zoneRef).toBe("discardPile");
    expect(invalidated.state.players[0]!.limits.attackCountRemaining).toBe(0);
    expect(invalidated.events.map((event) => event.eventType)).toContain(
      "attack.invalidated",
    );
  });

  it("finishes nested dying first, then cancels the paid attack if its first target was eliminated", () => {
    const prepared = ready();
    prepared.state.players[1]!.shield = 0;
    prepared.state.players[1]!.hp = 2;
    const paid = commitAttack(prepared.state, ruleset, {
        attackerSeat: 1,
        targetRefs: ["character:2"],
        killCardRefs: [prepared.kill],
      }),
      damaged = executeNextImmediateDamageEffect(paid.state, ruleset);
    expect(damaged.state.players[1]!.lifeState).toBe("dying");
    let state = openDyingRescue(damaged.state, 1000, ruleset).state;
    const dying = new DyingCommandSession(state, () => 1000);
    for (let index = 0; index < 4; index += 1) {
      const window = dying.state.pendingWindows[0]!,
        responder = dying.state.players.find(
          (player) => player.seat === window.prioritySeat,
        )!;
      dying.handle({
        commandId: `pass:${index}`,
        gameId: dying.state.gameId,
        expectedStateRevision: dying.state.stateRevision,
        actorUserId: responder.userId,
        promptId: window.promptId,
        offerId: window.legalOfferIds.find((offer) =>
          offer.includes(":pass:"),
        )!,
      });
    }
    state = dying.state;
    expect(state.players[1]!.lifeState).toBe("eliminated");
    const cancelled = executeNextImmediateDamageEffect(state, ruleset);
    expect(cancelled.state.combat.attack).toBeNull();
    expect(cancelled.state.cards[prepared.kill]!.zoneRef).toBe("discardPile");
    expect(cancelled.events.map((event) => event.eventType)).toContain(
      "attack.cancelled",
    );
  });

  it("does not retrigger in the same owner turn and becomes available on a later owner turn", () => {
    const first = ready();
    first.state.players[0]!.markers.bloodCurseUsedTurn = "3:1";
    const sameTurn = commitAttack(first.state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [first.kill],
    });
    expect(sameTurn.state.combat.attack).not.toBeNull();
    expect(sameTurn.state.scheduledEffects).toHaveLength(0);

    const later = ready();
    later.state.players[0]!.markers.bloodCurseUsedTurn = "2:1";
    const laterTurn = commitAttack(later.state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [later.kill],
    });
    expect(laterTurn.state.combat.attack).toBeNull();
    expect(laterTurn.state.scheduledEffects).toHaveLength(2);
  });
});
