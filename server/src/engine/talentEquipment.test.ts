import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import {
  TalentDiscardSession,
  TalentEquipSession,
  buildTalentEquipOffers,
} from "./talentEquipment.js";
import { moveCard } from "./zones.js";
import { calculateHandLimit } from "./handLimit.js";
import { EngineTransaction } from "./transaction.js";
import { setEquippedTalentContributionsEnabled } from "./talentContributions.js";
import { applyStatus } from "./status.js";
let r: LoadedRuleset;
beforeAll(async () => {
  r = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let s = createInitialSetup(r, {
    gameId: "talent-equip",
    firstSeat: 1,
    seed: 3701,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.ranger",
      3: "character.wizard",
      4: "character.druid",
    },
  });
  for (const n of [1, 2, 3, 4] as const)
    s = resolveInitialRedraw(s, n, false, r).state;
  Object.assign(s, {
    activeSeat: 1,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  s.pendingWindows = [
    {
      promptId: "play",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return s;
}
function hand(s: AuthoritativeGameState, id: string) {
  const c = Object.values(s.cards).find((x) => x.templateId === id)!,
    z = s.zones[c.zoneRef]!;
  z.orderedCardRefs.splice(z.orderedCardRefs.indexOf(c.cardRef), 1);
  s.zones["hand:1"]!.orderedCardRefs.push(c.cardRef);
  Object.assign(c, {
    zoneRef: "hand:1",
    ownerSeat: 1,
    controllerSeat: 1,
    faceUp: false,
  });
  return c.cardRef;
}
describe("talent equipment lifecycle", () => {
  it("equips max HP and rolls contribution back on loss", () => {
    let s = ready(),
      ref = hand(s, "talent.max_hp_up"),
      o = buildTalentEquipOffers(s, 1).find((x) => x.cardRef === ref)!,
      x = new TalentEquipSession(s, r);
    expect(
      x.handle({
        commandId: "equip",
        gameId: s.gameId,
        expectedStateRevision: s.stateRevision,
        actorUserId: "u1",
        promptId: "play",
        offerId: o.offerId,
        cardRef: ref,
      }).accepted,
    ).toBe(true);
    s = x.state;
    expect(s.players[0]).toMatchObject({ hp: 8, maxHp: 8 });
    s = moveCard(s, {
      cardRef: ref,
      toZoneRef: "discardPile",
      moveKind: "dismantle",
    }).state;
    expect(s.players[0]).toMatchObject({ hp: 6, maxHp: 6 });
  });
  it("loses a duplicate initial talent and draws one instead of equipping", () => {
    const s = ready(),
      ref = hand(s, "talent.blue_shield"),
      before = s.zones["hand:1"]!.orderedCardRefs.length,
      o = buildTalentEquipOffers(s, 1).find((x) => x.cardRef === ref)!,
      x = new TalentEquipSession(s, r);
    expect(o.duplicate).toBe(true);
    x.handle({
      commandId: "duplicate",
      gameId: s.gameId,
      expectedStateRevision: s.stateRevision,
      actorUserId: "u1",
      promptId: "play",
      offerId: o.offerId,
      cardRef: ref,
    });
    expect(x.state.cards[ref]!.zoneRef).toBe("discardPile");
    expect(x.state.zones["hand:1"]!.orderedCardRefs).toHaveLength(before);
  });
  it("allows an equipped talent to be actively discarded and rolls back its contribution", () => {
    let s=ready(),before=s.players[0]!.maxShield!,ref=hand(s,"talent.max_shield_up"),equip=new TalentEquipSession(s,r);
    const offer=buildTalentEquipOffers(s,1).find(x=>x.cardRef===ref)!;
    equip.handle({commandId:"equip-shield",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:offer.offerId,cardRef:ref});
    s=equip.state;expect(s.players[0]!.maxShield).toBe(before+1);
    const discard=new TalentDiscardSession(s);
    expect(discard.handle({commandId:"discard",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:`offer:talent-discard:${ref}`,cardRef:ref}).accepted).toBe(true);
    expect(discard.state.players[0]!.maxShield).toBe(before);
  });
  it("reads hand-limit contribution from the frozen rules and suspends/restores it with equipment effects",()=>{
    let s=ready(),before=calculateHandLimit(s,1),ref=hand(s,"talent.hand_limit_up"),equip=new TalentEquipSession(s,r),offer=buildTalentEquipOffers(s,1).find(x=>x.cardRef===ref)!;
    equip.handle({commandId:"equip-limit",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:offer.offerId,cardRef:ref});s=equip.state;
    expect(calculateHandLimit(s,1)).toBe(before+1);
    s=applyStatus(s,r,{ownerSeat:1,statusId:"status.equipmentDisabled",sourceRef:"test:disable"}).state;expect(calculateHandLimit(s,1)).toBe(before);
    s.players[0]!.statuses=[];
    const tx=new EngineTransaction(s);setEquippedTalentContributionsEnabled(tx,1,true);s=tx.commit().state;expect(calculateHandLimit(s,1)).toBe(before+1);
  });
});
