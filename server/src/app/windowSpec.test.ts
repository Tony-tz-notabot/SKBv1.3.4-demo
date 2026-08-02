import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,PendingWindowState,Seat} from "../engine/state.js";
import type {AppRoom} from "./types.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";

let ruleset:LoadedRuleset;
const users={1:"u1",2:"u2",3:"u3",4:"u4"} as const,characters={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function engineState(seed=991):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`spec-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1],2:users[2],3:users[3],4:users[4]},characterIdsBySeat:characters});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"SPEC",revision:1,phase:"inGame",settings:{roomName:"s",allowGuests:true,allowSpectators:true,turnTimeSeconds:30,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true},passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat],seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function move(state:AuthoritativeGameState,ref:string,to:string,owner:Seat){const card=state.cards[ref]!,from=state.zones[card.zoneRef]!;from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);state.zones[to]!.orderedCardRefs.push(ref);Object.assign(card,{zoneRef:to,ownerSeat:owner,controllerSeat:owner,faceUp:!to.startsWith("hand:")});}
function findTemplate(state:AuthoritativeGameState,prefix:string):string|undefined{return Object.values(state.cards).find(card=>card.templateId.startsWith(prefix))?.cardRef;}
function window(state:AuthoritativeGameState,w:PendingWindowState){state.pendingWindows=[w];}
function gameSnap(state:AuthoritativeGameState,userId:string){const snap=new GameProjector(ruleset).game(makeRoom(state),userId) as any;expect(validateProtocol("game",snap)).toEqual({ok:true});return snap;}
const offers=(snap:any)=>(snap.interaction.offers as any[]);
const spec=(offer:any,key:string)=>(offer.selectionSpecs as any[]).find((s:any)=>s.key===key);

describe("window selection spec precision",()=>{
 it("keeps attack response offers scoped to their own legal card sets",()=>{
  const state=engineState(),dodge=findTemplate(state,"basic.dodge.")!,weaponCard=Object.values(state.cards).find(card=>card.templateId.startsWith("weapon.")&&!card.templateId.includes("w43"))!,weapon=weaponCard!.cardRef;
  move(state,dodge,"hand:2",2);move(state,weapon,"weapon:1:2",2);
  window(state,{promptId:"prompt:r:2",kind:"attackResponse",prioritySeat:2,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:[`offer:attack-response:pass:a:1`,`offer:attack-response:dodge:a:1`,`offer:attack-response:meleeBlock:a:1`],context:{attackId:"a:1",targetRef:"character:2",legalDodgeCardRefs:[dodge],legalMeleeBlockRefs:[weapon]}});
  const snap=gameSnap(state,"u2"),dodgeOffer=offers(snap).find((o:any)=>o.offerId.includes(":dodge:")),blockOffer=offers(snap).find((o:any)=>o.offerId.includes(":meleeBlock:")),passOffer=offers(snap).find((o:any)=>o.kind==="pass");
  expect(spec(dodgeOffer,"cards")!.legalRefs).toEqual([`private:u2:${dodge}`]);
  expect(spec(blockOffer,"cards")!.legalRefs).toEqual([`public:${weapon}`]);
  expect(spec(passOffer,"cards")).toBeUndefined();
 });
 it("scopes dying rescue offers to potions, red prayers and resurrection crosses",()=>{
  const state=engineState(),potion=findTemplate(state,"basic.potion.")!;
  const redCard=Object.values(state.cards).find(card=>{const fact=(ruleset.documents.get("cards.json") as {items:Array<{cardId:string;color:string}>}).items.find(x=>x.cardId===card.templateId);return fact?.color==="red";});
  const red=redCard?.cardRef??findTemplate(state,"basic.horn.")!,cross=Object.values(state.cards).find(card=>card.templateId==="weapon.w43")?.cardRef;
  move(state,potion,"hand:1",1);move(state,red,"hand:1",1);if(cross)move(state,cross,"weapon:1:1",1);
  window(state,{promptId:"prompt:dying:c:2:1",kind:"dyingRescue",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:[`offer:dying:pass:character:2`,`offer:dying:rescue:character:2`,`offer:dying:prayer:character:2`,...(cross?[`offer:dying:resurrectionCross:character:2`]:[])],context:{dyingRef:"character:2",eligibleSeats:[1,2,3,4],passedSeats:[],legalCardRefs:[potion],legalPrayerCardRefs:[red],legalResurrectionCrossRefs:cross?[cross]:[]}});
  const snap=gameSnap(state,"u1"),rescueOffer=offers(snap).find((o:any)=>o.offerId.includes(":rescue:")),prayerOffer=offers(snap).find((o:any)=>o.offerId.includes(":prayer:")),crossOffer=offers(snap).find((o:any)=>o.offerId.includes(":resurrectionCross:")),passOffer=offers(snap).find((o:any)=>o.offerId.includes(":pass:"));
  expect(spec(rescueOffer,"cards")!.legalRefs).toEqual([`private:u1:${potion}`]);
  expect(spec(prayerOffer,"cards")!.legalRefs).toEqual([`private:u1:${red}`]);
  if(cross)expect(spec(crossOffer,"cards")!.legalRefs).toEqual([`public:${cross}`]);
  expect(spec(passOffer,"cards")).toBeUndefined();
 });
 it("uses context minimum/maximum for trigger card selection",()=>{
  const state=engineState(),a=findTemplate(state,"basic.kill.")!,b=findTemplate(state,"basic.dodge.")!,c=findTemplate(state,"basic.potion.")!;
  for(const [ref,seat] of [[a,1],[b,1],[c,1]] as Array<[string,Seat]>)move(state,ref,"hand:1",seat);
  window(state,{promptId:"prompt:tc:1",kind:"triggerCardSelection",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:[`offer:trigger-card:pass`,`offer:trigger-card:0`,`offer:trigger-card:1`,`offer:trigger-card:2`],context:{candidate:null,event:null,legalCardRefs:[a,b,c],minimum:1,maximum:2}});
  const snap=gameSnap(state,"u1"),offer=offers(snap).find((o:any)=>o.kind!=="pass");
  expect(spec(offer,"cards")).toMatchObject({min:1,max:2});
  expect(spec(offer,"cards")!.legalRefs).toEqual([`private:u1:${a}`,`private:u1:${b}`,`private:u1:${c}`]);
 });
 it("projects demolition overflow with requiredCount as min and max",()=>{
  const state=engineState(),w1=findTemplate(state,"weapon.")!,w2=findTemplate(state,"weapon.")!;
  move(state,w1,"weapon:1:1",1);move(state,w2,"thirdWeapon:1",1);
  window(state,{promptId:"prompt:demo:1",kind:"demolitionWeaponOverflow",prioritySeat:1,mandatory:true,deadlineAt:900,timeoutPolicy:"randomLegal",legalOfferIds:["offer:demolition-overflow:submit"],context:{legalWeaponRefs:[w1,w2],regularWeaponRefs:[w1],thirdWeaponRefs:[w2],requiredCount:2}});
  const snap=gameSnap(state,"u1"),offer=offers(snap)[0];
  expect(spec(offer,"cards")).toMatchObject({min:2,max:2});
 });
 it("keeps statue selection sources concealed",()=>{
  const state=engineState(),secret=findTemplate(state,"basic.kill.")!;
  move(state,secret,"hand:2",2);
  window(state,{promptId:"prompt:statue:1",kind:"statueCardSelection",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"randomLegal",legalOfferIds:[`offer:statue:0`],context:{legalCardRefs:[secret]}});
  const snap=gameSnap(state,"u1"),offer=offers(snap)[0];
  expect(offer.sourceRefs).toEqual([`concealed:prompt:statue:1:0`]);expect(JSON.stringify(offer)).not.toContain(secret);
  expect(validateProtocol("game",snap)).toEqual({ok:true});
 });
});
