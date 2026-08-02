import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { buildQiBallOffers, QiBallSession } from "./qiMaster.js";
import { BomberSession, buildBomberOffers } from "./trapMaster.js";
import {
  EngineerMechChoiceSession,
  openEngineerMechAtPrepare,
} from "./engineer.js";
import { buildVineOffers, VineSession } from "./druid.js";
import { EngineTransaction } from "./transaction.js";
let r: LoadedRuleset;
beforeAll(async () => {
  r = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
const chars = {
  1: "character.qi_master",
  2: "character.trap_master",
  3: "character.engineer",
  4: "character.druid",
} as const;
function ready(seat: Seat) {
  let s = createInitialSetup(r, {
    gameId: `late-${seat}`,
    firstSeat: seat,
    seed: 3600 + seat,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: chars,
  });
  for (const n of [1, 2, 3, 4] as const)
    s = resolveInitialRedraw(s, n, false, r).state;
  Object.assign(s, {
    activeSeat: seat,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  s.players[seat - 1]!.limits.attackCountRemaining = 1;
  s.pendingWindows = [
    {
      promptId: `play:${seat}`,
      kind: "playPhaseAction",
      prioritySeat: seat,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return s;
}
function putHand(s: AuthoritativeGameState, seat: Seat, n: number) {
  const refs = Object.values(s.cards)
    .slice(0, n)
    .map((x) => x.cardRef);
  for (const ref of refs) {
    const c = s.cards[ref]!,
      z = s.zones[c.zoneRef]!;
    z.orderedCardRefs.splice(z.orderedCardRefs.indexOf(ref), 1);
    s.zones[`hand:${seat}`]!.orderedCardRefs.push(ref);
    Object.assign(c, {
      zoneRef: `hand:${seat}`,
      ownerSeat: seat,
      controllerSeat: seat,
      faceUp: false,
    });
  }
  return refs;
}
describe("late character execution batch", () => {
  it("R036 commits Qi Ball with two hand cards and one attack count", () => {
    const s = ready(1),
      cards = putHand(s, 1, 2),
      o = buildQiBallOffers(s, r, 1)[0]!,
      x = new QiBallSession(s, r);
    expect(
      x.handle({
        commandId: "qi",
        gameId: s.gameId,
        expectedStateRevision: s.stateRevision,
        actorUserId: "u1",
        promptId: "play:1",
        offerId: o.offerId,
        cardRefs: cards,
        targetRef: "character:2",
      }).accepted,
    ).toBe(true);
    expect(x.state.players[0]!.limits.attackCountRemaining).toBe(0);
    expect(x.state.combat.attack).toMatchObject({
      weaponId: "skill.qi_master.qi_ball",
    });
  });
  it("R039/R040 converts 1-5 cards to public bombs", () => {
    const s = ready(2),
      cards = putHand(s, 2, 3),
      o = buildBomberOffers(s, r, 2)[0]!,
      x = new BomberSession(s, r);
    expect(
      x.handle({
        commandId: "bomb",
        gameId: s.gameId,
        expectedStateRevision: s.stateRevision,
        actorUserId: "u2",
        promptId: "play:2",
        offerId: o.offerId,
        cardRefs: cards,
      }).accepted,
    ).toBe(true);
    expect(x.state.players[1]!.markers["trap.bombs"]).toBe(3);
  });
  it("R041 enters one mandatory selected mech on first prepare", () => {
    const s = ready(3);
    s.pendingWindows = [];
    const tx = new EngineTransaction(s);
    expect(openEngineerMechAtPrepare(tx, 3, 900)).toBe(true);
    const q = tx.commit().state,
      w = q.pendingWindows[0]!,
      x = new EngineerMechChoiceSession(q);
    expect(
      x.handle({
        commandId: "mech",
        gameId: q.gameId,
        expectedStateRevision: q.stateRevision,
        actorUserId: "u3",
        promptId: w.promptId,
        offerId: "offer:engineer-mech:prototype",
      }).accepted,
    ).toBe(true);
    expect(x.state.players[2]).toMatchObject({
      ironShield: 1,
      markers: { "engineer.mechShield": 5, "engineer.mechPrepareOrdinal": 1 },
    });
  });
  it("R046 commits Vine as poison attack and starts cooldown", () => {
    const s = ready(4),
      o = buildVineOffers(s, r, 4)[0]!,
      x = new VineSession(s, r);
    expect(
      x.handle({
        commandId: "vine",
        actorUserId: "u4",
        promptId: "play:4",
        offerId: o.offerId,
        targetRef: "character:1",
      }).accepted,
    ).toBe(true);
    expect(x.state.combat.attack).toMatchObject({
      cannotMeleeBlock: true,
      ignoreArmor: true,
      damageSegments: [{ element: "poison", amount: 1 }],
    });
    expect(x.state.players[3]!.markers["druid.vineCooldown"]).toBe(2);
  });
});
