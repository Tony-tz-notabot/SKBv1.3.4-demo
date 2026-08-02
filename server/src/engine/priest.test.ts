import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import {
  buildPriestOffers,
  PriestSession,
  resetPriestAtPrepare,
} from "./priest.js";
import { EngineTransaction } from "./transaction.js";
import { openDyingRescue, DyingCommandSession } from "./dying.js";
let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function move(s: AuthoritativeGameState, ref: string, to: string) {
  const c = s.cards[ref]!,
    from = s.zones[c.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  s.zones[to]!.orderedCardRefs.push(ref);
  c.zoneRef = to;
  c.ownerSeat = s.zones[to]!.ownerSeat;
  c.controllerSeat = c.ownerSeat;
}
function ready() {
  let s = createInitialSetup(ruleset, {
    gameId: "priest",
    firstSeat: 1,
    seed: 359,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.priest",
      2: "character.knight",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    s = resolveInitialRedraw(s, seat, false, ruleset).state;
  s.activeSeat = 1;
  s.phase = "play";
  s.phaseMode = "manual";
  s.phaseBoundary = "body";
  s.phaseBodyResolved = false;
  s.pendingWindows = [
    {
      promptId: "play",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 9,
      timeoutPolicy: "pass",
      legalOfferIds: [],
    },
  ];
  return s;
}
function colorRef(s: AuthoritativeGameState, color: string) {
  const colors = new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((x) => [x.cardId, x.color]),
  );
  return Object.values(s.cards).find((c) => colors.get(c.templateId) === color)!
    .cardRef;
}
describe("Priest", () => {
  it("uses only a white hand card for Hope", () => {
    let s = ready(),
      white = colorRef(s, "white");
    move(s, white, "hand:1");
    s.players[1]!.hp = 2;
    const offer = buildPriestOffers(s, ruleset, 1).find(
      (o) => o.abilityId === "skill.priest.hope",
    )!;
    expect(offer.legalCardRefs).toContain(white);
    move(s, white, "armor:1");
    expect(
      buildPriestOffers(s, ruleset, 1).find(
        (o) => o.abilityId === "skill.priest.hope",
      )?.legalCardRefs,
    ).not.toContain(white);
    move(s, white, "hand:1");
    const session = new PriestSession(s, ruleset);
    expect(
      session.handle({
        commandId: "hope",
        gameId: s.gameId,
        expectedStateRevision: s.stateRevision,
        actorUserId: "u1",
        promptId: "play",
        offerId: offer.offerId,
        cardRef: white,
        targetRef: "character:2",
      }).accepted,
    ).toBe(true);
    expect(session.state.players[1]!.hp).toBe(3);
  });
  it("shares Prayer between active and dying response and resets at prepare", () => {
    let s = ready(),
      red = colorRef(s, "red");
    move(s, red, "hand:1");
    s.players[1]!.hp = 1;
    const offer = buildPriestOffers(s, ruleset, 1).find(
        (o) => o.abilityId === "skill.priest.pray",
      )!,
      active = new PriestSession(s, ruleset);
    active.handle({
      commandId: "pray",
      gameId: s.gameId,
      expectedStateRevision: s.stateRevision,
      actorUserId: "u1",
      promptId: "play",
      offerId: offer.offerId,
      cardRef: red,
      targetRef: "character:2",
    });
    expect(
      buildPriestOffers(active.state, ruleset, 1).find(
        (o) => o.abilityId === "skill.priest.pray",
      ),
    ).toBeUndefined();
    const tx = new EngineTransaction(active.state);
    resetPriestAtPrepare(tx, 1);
    expect(tx.draft.players[0]!.markers["priest.prayUsed"]).toBeUndefined();
  });
  it("offers a red hand card as a 2-point dying Prayer without Strong Potion bonus", () => {
    let s = ready(),
      red = colorRef(s, "red");
    move(s, red, "hand:1");
    s.pendingWindows = [];
    s.players[1]!.hp = -1;
    s.players[1]!.lifeState = "dying";
    s.combat.dyingStack = ["character:2"];
    s = openDyingRescue(s, 10, ruleset).state;
    const w = s.pendingWindows[0]!;
    expect(w.legalOfferIds.some((id) => id.includes(":prayer:"))).toBe(true);
    const session = new DyingCommandSession(s, () => 20, ruleset),
      offerId = w.legalOfferIds.find((id) => id.includes(":prayer:"))!;
    expect(
      session.handle({
        commandId: "response-pray",
        gameId: s.gameId,
        expectedStateRevision: s.stateRevision,
        actorUserId: "u1",
        promptId: w.promptId,
        offerId,
        cardRef: red,
      }).accepted,
    ).toBe(true);
    expect(session.state.players[1]).toMatchObject({
      hp: 1,
      lifeState: "alive",
    });
    expect(session.state.players[0]!.markers["priest.prayUsed"]).toBe(true);
  });
});
