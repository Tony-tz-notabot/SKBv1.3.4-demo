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
  it("keeps the talent zone capped at 3: offers only target slots 0-2, equipping when full replaces instead of exceeding the cap",()=>{
    let s=ready();
    for(const id of["talent.max_hp_up","talent.max_shield_up","talent.hand_limit_up"]){const c=Object.values(s.cards).find(x=>x.templateId===id)!;s=moveCard(s,{cardRef:c.cardRef,toZoneRef:"talent:1",moveKind:"equip"}).state;}
    expect(s.zones["talent:1"]!.orderedCardRefs).toHaveLength(3);
    const ref=hand(s,"talent.melee_counter");
    const offers=buildTalentEquipOffers(s,1).filter(x=>x.cardRef===ref);
    expect(offers.length,"天赋槽满时仍提供 3 个替换 offer（选槽位）").toBe(3);
    for(const o of offers)expect(o.replacedCardRef,"满槽时每个 offer 都应替换某张已装备天赋").toBeTruthy();
    let session=new TalentEquipSession(s,r);
    const o=offers.find(x=>x.offerId.endsWith(":slot:2"))!;
    expect(session.handle({commandId:"eq-cap",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:o.offerId,cardRef:ref}).accepted).toBe(true);
    expect(session.state.zones["talent:1"]!.orderedCardRefs,"装备第 4 张天赋必须替换旧卡，不能超过 3 张").toHaveLength(3);
  });
  it("routes an equip offer to a specific talent slot and marks the replaced occupant",()=>{
    let s=ready();
    for(const id of["talent.max_hp_up","talent.max_shield_up"]){const ref=hand(s,id),session=new TalentEquipSession(s,r),o=buildTalentEquipOffers(s,1).find(x=>x.cardRef===ref&&!x.replacedCardRef)!;
      expect(o.offerId,"首次装备应指向空闲槽位").toMatch(/:slot:\d$/);
      expect(session.handle({commandId:`fill-${id}`,gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:o.offerId,cardRef:ref}).accepted).toBe(true);s=session.state;}
    expect(s.zones["talent:1"]!.orderedCardRefs).toHaveLength(2);
    const ref=hand(s,"talent.hand_limit_up"),offers=buildTalentEquipOffers(s,1).filter(x=>x.cardRef===ref);
    expect(offers.length,"zone 有 2 张时应生成 3 个带槽位 offer：替换 0/1 + 放入 2").toBe(3);
    for(const o of offers)expect(o.offerId,`offer 应携带目标槽位 :slot:N`).toMatch(/:slot:[0-3]$/);
    expect(new Set(offers.map(o=>o.offerId)).size,"每个 offer 指向不同槽位").toBe(3);
    const replaceOffers=offers.filter(o=>o.replacedCardRef),placement=offers.find(o=>!o.replacedCardRef);
    expect(replaceOffers.length,"占用槽位各提供一个替换 offer").toBe(2);
    expect(placement?.offerId,"空闲槽位提供放入 offer").toMatch(/:slot:2$/);
  });
  it("equips into the requested slot and replaces the occupant when that slot is occupied",()=>{
    let s=ready(),first=hand(s,"talent.max_hp_up"),second=hand(s,"talent.hand_limit_up");
    let session=new TalentEquipSession(s,r),o1=buildTalentEquipOffers(s,1).find(x=>x.cardRef===first)!;
    expect(session.handle({commandId:"eq1",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:o1.offerId,cardRef:first}).accepted).toBe(true);s=session.state;
    expect(s.zones["talent:1"]!.orderedCardRefs,"装备应落到天赋区").toContain(first);
    session=new TalentEquipSession(s,r);const o2=buildTalentEquipOffers(s,1).find(x=>x.cardRef===second&&x.offerId.endsWith(":slot:0"))!;
    expect(o2.replacedCardRef,"占用槽位应携带被替换的天赋").toBe(first);
    expect(session.handle({commandId:"eq2",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:o2.offerId,cardRef:second}).accepted).toBe(true);
    expect(session.state.cards[first]!.zoneRef,"替换旧天赋应弃置旧天赋").toBe("discardPile");
    expect(session.state.zones["talent:1"]!.orderedCardRefs,"新天赋应落到所换槽位").toContain(second);
  });
  it("rejects a slot offer with an invalid slot index (out of 0-3)",()=>{
    const s=ready(),ref=hand(s,"talent.hand_limit_up"),session=new TalentEquipSession(s,r);
    const result=session.handle({commandId:"bad-slot",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:`offer:talent-equip:${ref}:slot:9`,cardRef:ref});
    expect(result.accepted).toBe(false);
  });
});
