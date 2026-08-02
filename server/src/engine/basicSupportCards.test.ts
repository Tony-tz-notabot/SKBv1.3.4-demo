import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { BasicSupportCardSession, buildBasicSupportOffers } from "./basicSupportCards.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
let r: LoadedRuleset;
beforeAll(async()=>{r=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"))});
function ready(){
  let s=createInitialSetup(r,{gameId:"support",firstSeat:1,seed:4001,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.ranger",3:"character.wizard",4:"character.druid"}});
  for(const n of[1,2,3,4]as const)s=resolveInitialRedraw(s,n,false,r).state;
  Object.assign(s,{activeSeat:1,phase:"play",phaseBoundary:"body",phaseMode:"manual",phaseBodyResolved:false});
  s.pendingWindows=[{promptId:"play",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}}];
  return s;
}
function move(s:ReturnType<typeof ready>,id:string,to:string){
  const c=Object.values(s.cards).find(x=>x.templateId.startsWith(id))!,z=s.zones[c.zoneRef]!;
  z.orderedCardRefs.splice(z.orderedCardRefs.indexOf(c.cardRef),1);s.zones[to]!.orderedCardRefs.push(c.cardRef);
  Object.assign(c,{zoneRef:to,ownerSeat:1,controllerSeat:1,faceUp:!to.startsWith("hand:")});return c.cardRef;
}
describe("strong potion",()=>{
  it("adds one to potion recovery while equipped and stops under equipment disable",()=>{
    let s=ready();s.players[0]!.hp=1;
    move(s,"talent.strong_potion","talent:1");const potion=move(s,"basic.potion.","hand:1");
    let offer=buildBasicSupportOffers(s,r,1).find(x=>x.cardRef===potion)!;expect(offer.amount).toBe(3);
    s.players[0]!.statuses.push({statusRef:"disabled",statusId:"status.equipmentDisabled",ownerSeat:1,sourceRef:null,stackPolicy:"uniqueIgnore",stacks:1,priority:0,durationId:null,skipPhases:[],metadata:{}});
    offer=buildBasicSupportOffers(s,r,1).find(x=>x.cardRef===potion)!;expect(offer.amount).toBe(2);
    s.players[0]!.statuses=[];const x=new BasicSupportCardSession(s,r);
    expect(x.handle({commandId:"use",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:buildBasicSupportOffers(s,r,1).find(o=>o.cardRef===potion)!.offerId,cardRef:potion}).accepted).toBe(true);
    expect(x.state.players[0]!.hp).toBe(4);
  });
});
