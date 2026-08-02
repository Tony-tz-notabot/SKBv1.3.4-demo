import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { buildAttackOffer, commitAttack } from "./attack.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { elfAimMarkerId } from "./elfAim.js";
import { AttackResponseSession } from "./response.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
import { setWeaponPreselection } from "./preselection.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "elf-aim",
    firstSeat: 1,
    seed: 733,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.elf",
      2: "character.knight",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  for (const player of state.players) {
    player.hp = 10;
    player.maxHp = 10;
    player.shield = 0;
    player.maxShield = 10;
  }
  state.pendingWindows = [];
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
function scripted(
  state: AuthoritativeGameState,
  attackerSeat: Seat,
  targetRef: string,
  damageType = "normal",
) {
  const tx = new EngineTransaction(state);
  createScriptedAttackInTransaction(tx, {
    attackId: `attack:aim-source:${attackerSeat}:${state.stateRevision}`,
    attackerSeat,
    targetRef,
    sourceRef: `character:${attackerSeat}`,
    weaponId: "test",
    modeId: "test",
    range: "unlimited",
    attackTypes: ["ranged"],
    damageSegments: [
      {
        segmentId: "test",
        deliveryType: "attack",
        attackType: "ranged",
        damageType,
        element: "none",
        amount: 2,
        repeat: 1,
        isAdditional: false,
        overflowPolicy: "normal",
      } as unknown as JsonValue,
    ],
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  return committed.state;
}
function passAndRun(state: AuthoritativeGameState, id: string) {
  state = runCombatUntilBlocked(state, ruleset, () => 1000).state;
  const window = state.pendingWindows[0]!,
    session = new AttackResponseSession(state, ruleset),
    actor = state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
  session.handle({
    commandId: id,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.includes(":pass:"))!,
  });
  return runCombatUntilBlocked(session.state, ruleset, () => 1000).state;
}
describe("Elf focused aim", () => {
  it("records the latest attack source only after actual hp loss", () => {
    let state = passAndRun(scripted(ready(), 2, "character:1"), "source-2");
    expect(state.players[0]!.markers[elfAimMarkerId]).toBe("character:2");
    state.players[0]!.shield = 5;
    state = passAndRun(
      scripted(state, 3, "character:1", "shield"),
      "shield-only",
    );
    expect(state.players[0]!.markers[elfAimMarkerId]).toBe("character:2");
    state.players[0]!.shield = 0;
    state = passAndRun(scripted(state, 3, "character:1"), "source-3");
    expect(state.players[0]!.markers[elfAimMarkerId]).toBe("character:3");
  });

  it("still requires Kill and preselection, waives only count against aim, and clears after hp loss", () => {
    let state = passAndRun(
      scripted(ready(), 2, "character:1"),
      "establish-aim",
    );
    state.activeSeat = 1;
    state.players[0]!.limits.attackCountRemaining = 0;
    const kill = Object.values(state.cards).find((card) =>
      card.templateId.startsWith("basic.kill."),
    )!.cardRef;
    relocate(state, kill, "hand:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    const offer = buildAttackOffer(state, 1, ruleset);
    expect(offer).toMatchObject({
      payable: true,
      attackCountCost: 0,
      attackCountWaivedTargetRef: "character:2",
    });
    expect(() =>
      commitAttack(state, ruleset, {
        attackerSeat: 1,
          targetRefs: ["character:4"],
        killCardRefs: [kill],
      }),
    ).toThrow("ATTACK_COUNT_UNPAYABLE");
    state = commitAttack(state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [kill],
    }).state;
    expect(state.players[0]!.limits.attackCountRemaining).toBe(0);
    expect(state.cards[kill]!.zoneRef).toBe("resolving");
    state = passAndRun(state, "aim-attack");
    expect(state.players[0]!.markers[elfAimMarkerId]).toBeUndefined();
  });
});
