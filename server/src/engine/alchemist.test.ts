import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { buildToxicReagentOffers, ToxicReagentSession } from "./alchemist.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
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
function colorOf(templateId: string) {
  return (
    ruleset.documents.get("cards.json") as {
      items: Array<{ cardId: string; color: string }>;
    }
  ).items.find((item) => item.cardId === templateId)?.color;
}
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "alchemist",
    firstSeat: 1,
    seed: 606,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.alchemist",
      2: "character.knight",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  const green = Object.values(state.cards).find(
      (card) => colorOf(card.templateId) === "green",
    )!,
    red = Object.values(state.cards).find(
      (card) => colorOf(card.templateId) === "red",
    )!;
  relocate(state, green.cardRef, "hand:1");
  relocate(state, red.cardRef, "hand:1");
  Object.assign(state, {
    activeSeat: 1,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  state.pendingWindows = [
    {
      promptId: "play:alchemist",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  state.players[1]!.shield = 10;
  state.players[1]!.maxShield = 10;
  state.players[1]!.hp = 10;
  state.players[1]!.maxHp = 10;
  return { state, green: green.cardRef, red: red.cardRef };
}
function command(
  prepared: ReturnType<typeof ready>,
  targetRef = "character:2",
  cardRef = prepared.green,
) {
  return {
    commandId: "toxic",
    gameId: prepared.state.gameId,
    expectedStateRevision: prepared.state.stateRevision,
    actorUserId: "u1",
    promptId: "play:alchemist",
    offerId: "offer:skill.alchemist.toxic_reagent",
    cardRef,
    targetRef,
  };
}

describe("Alchemist Toxic Reagent", () => {
  it("offers only green hand cards and targets within configured distance two", () => {
    const prepared = ready(),
      offer = buildToxicReagentOffers(prepared.state, ruleset, 1)[0]!;
    expect(offer.legalCardRefs).toContain(prepared.green);
    expect(offer.legalCardRefs).not.toContain(prepared.red);
    expect(offer.legalTargetRefs).toEqual([
      "character:2",
      "character:3",
      "character:4",
    ]);
    prepared.state.players[2]!.limits.defenseDistanceModifier = 1;
    expect(
      buildToxicReagentOffers(prepared.state, ruleset, 1)[0]!.legalTargetRefs,
    ).not.toContain("character:3");
  });

  it("pays one green card and creates a field poison 1x2 attack without Kill or attack count", () => {
    const prepared = ready(),
      beforeCount = prepared.state.players[0]!.limits.attackCountRemaining,
      session = new ToxicReagentSession(prepared.state, ruleset),
      cmd = command(prepared),
      result = session.handle(cmd);
    expect(result.accepted).toBe(true);
    expect(session.handle(cmd)).toEqual(result);
    expect(session.state.cards[prepared.green]!.zoneRef).toBe("resolving");
    expect(session.state.combat.attack).toMatchObject({
      attackTypes: ["field"],
      range: 2,
      ignoreArmor: true,
      ignoreTalentModifiers: true,
      killCardRefs: [],
      costCardRefs: [prepared.green],
      damageSegments: [{ element: "poison", amount: 1, repeat: 2 }],
    });
    expect(session.state.players[0]!.limits.attackCountRemaining).toBe(
      beforeCount,
    );
    const resolved = runCombatUntilBlocked(session.state, ruleset, () => 1000);
    expect(resolved.stoppedReason).toBe("playWindow");
    expect(resolved.state.players[1]!.shield).toBe(8);
    expect(resolved.state.cards[prepared.green]!.zoneRef).toBe("discardPile");
    expect(resolved.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
    });
    expect(buildToxicReagentOffers(resolved.state, ruleset, 1)).toEqual([]);
  });

  it("rejects non-green and newly out-of-range selections without mutation", () => {
    const prepared = ready(),
      session = new ToxicReagentSession(prepared.state, ruleset),
      revision = prepared.state.stateRevision,
      wrong = session.handle(command(prepared, "character:2", prepared.red));
    expect(wrong).toMatchObject({
      accepted: false,
      reasonCode: "COST_CARD_NO_LONGER_LEGAL",
    });
    expect(session.state.stateRevision).toBe(revision);
    const prepared2 = ready();
    prepared2.state.players[1]!.limits.defenseDistanceModifier = 9;
    const session2 = new ToxicReagentSession(prepared2.state, ruleset),
      result = session2.handle(command(prepared2));
    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "TARGET_NO_LONGER_LEGAL",
    });
    expect(session2.state.cards[prepared2.green]!.zoneRef).toBe("hand:1");
  });
});
