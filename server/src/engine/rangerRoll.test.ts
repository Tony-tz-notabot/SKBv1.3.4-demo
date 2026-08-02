import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { setWeaponPreselection } from "./preselection.js";
import { AttackResponseSession, openAttackResponse } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { advanceTimeline } from "./timeline.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(state: AuthoritativeGameState, ref: string, to: string) {
  const card = state.cards[ref]!,
    from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  state.zones[to]!.orderedCardRefs.push(ref);
  card.zoneRef = to;
  card.ownerSeat = state.zones[to]!.ownerSeat;
  card.controllerSeat = state.zones[to]!.ownerSeat;
  card.faceUp = !["drawPile", "hand"].includes(state.zones[to]!.zoneType);
}

function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "ranger-roll",
    firstSeat: 1,
    seed: 347,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.ranger",
      3: "character.alchemist",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "play";
  state.phaseMode = "manual";
  state.phaseBoundary = "body";
  state.phaseBodyResolved = false;
  return state;
}

function orangeRef(state: AuthoritativeGameState) {
  const colors = new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((card) => [card.cardId, card.color]),
  );
  return Object.values(state.cards).find(
    (card) => colors.get(card.templateId) === "orange",
  )!.cardRef;
}

describe("Ranger Roll", () => {
  it("is a legal ordinary Dodge response and makes the whole attack miss", () => {
    let state = ready();
    state.activeSeat = 1;
    state.players[0]!.limits.attackCountRemaining = 1;
    const kill = Object.values(state.cards).find((card) =>
        card.templateId.startsWith("basic.kill."),
      )!.cardRef,
      orange = orangeRef(state);
    relocate(state, kill, "hand:1");
    relocate(state, orange, "hand:2");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    state = commitAttack(state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [kill],
    }).state;
    state = openAttackResponse(state, ruleset, 500).state;
    const window = state.pendingWindows[0]!,
      offerId = window.legalOfferIds.find((id) =>
        id.includes(":skill:ranger.roll:"),
      )!;
    expect(offerId).toBeTruthy();
    const session = new AttackResponseSession(state, ruleset);
    expect(
      session.handle({
        commandId: "roll",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u2",
        promptId: window.promptId,
        offerId,
        cardRef: orange,
      }).accepted,
    ).toBe(true);
    expect(session.state.cards[orange]!.zoneRef).toBe("discardPile");
    expect(session.state.combat.attack).toMatchObject({
      currentTargetHit: false,
      currentTargetResult: "miss",
    });
    expect(
      session.state.players[1]!.markers["ranger.rollPendingNextTurn"],
    ).toBe(true);
    expect(
      session.state.players[1]!.markers.guaranteedCriticalGrants,
    ).toBeUndefined();
  });

  it("arms only at the next own turn start and expires at that turn end", () => {
    let state = ready();
    state.players[1]!.markers["ranger.rollPendingNextTurn"] = true;
    state.activeSeat = 1;
    state.phase = "end";
    state.phaseMode = "automatic";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state.pendingWindows = [];
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.activeSeat).toBe(2);
    expect(
      state.players[1]!.markers["ranger.rollPendingNextTurn"],
    ).toBeUndefined();
    expect(state.players[1]!.markers.guaranteedCriticalGrants).toEqual([
      expect.objectContaining({
        sourceRef: "skill.ranger.roll",
        appliesTo: "killAttack",
        consumePolicy: "retainUntilExpiry",
        expiryPoint: "owner.currentTurn.end",
      }),
    ]);
    state.phase = "end";
    state.phaseMode = "automatic";
    state.phaseBoundary = "body";
    state.phaseBodyResolved = true;
    state.pendingWindows = [];
    state = advanceTimeline(state, { kind: "normal" }, ruleset).state;
    expect(state.activeSeat).toBe(3);
    expect(state.players[1]!.markers.guaranteedCriticalGrants).toBeUndefined();
  });

  it("retains guaranteed critical for every Kill attack in the armed turn", () => {
    let state = ready();
    state.activeSeat = 2;
    state.players[1]!.limits.attackCountRemaining = 2;
    state.players[1]!.markers.guaranteedCriticalGrants = [
      {
        grantId: "critical-grant:ranger-roll:test",
        sourceRef: "skill.ranger.roll",
        ownerSeat: 2,
        appliesTo: "killAttack",
        consumePolicy: "retainUntilExpiry",
        expiryPoint: "owner.currentTurn.end",
      },
    ];
    const kills = Object.values(state.cards)
      .filter((card) => card.templateId.startsWith("basic.kill."))
      .slice(0, 2)
      .map((card) => card.cardRef);
    kills.forEach((ref) => relocate(state, ref, "hand:2"));
    state = setWeaponPreselection(state, 2, "weapon:1:2", null, ruleset).state;
    for (const [index, kill] of kills.entries()) {
      state = commitAttack(state, ruleset, {
        attackerSeat: 2,
        targetRefs: ["character:1"],
        killCardRefs: [kill],
      }).state;
      expect(state.combat.attack).toMatchObject({
        guaranteedCritical: true,
        critical: true,
      });
      expect(state.players[1]!.markers.guaranteedCriticalGrants).toHaveLength(
        1,
      );
      if (index === 0) {
        state.combat.attack = null;
        state.combat.targetQueue = [];
        state.combat.currentTargetRef = null;
        relocate(state, kill, "discardPile");
      }
    }
  });
});
