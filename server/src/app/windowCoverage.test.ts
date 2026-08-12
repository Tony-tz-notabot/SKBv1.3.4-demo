import {readdir,readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {activateBossInTransaction,onBossOwnerTurnStart} from "../engine/bossLifecycle.js";
import {resolvePhaseBody} from "../engine/phaseBody.js";
import {beginStatueResolution} from "../engine/statueEffects.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {EngineTransaction} from "../engine/transaction.js";
import {GameService} from "./gameService.js";
import {GameProjector,resolveWindowSelectionValues} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import {supportsWindow} from "./windowRegistry.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;

const settings:AppSettings={roomName:"窗口覆盖测试",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一号"},2:{userId:"u2",displayName:"二号"},3:{userId:"u3",displayName:"三号"},4:{userId:"u4",displayName:"四号"}};
const registryKinds=["berserkerRage","c6LaserSweepRequest","c6FocusedBombardmentRequest","criticalPenetration","crystalCrabActivePincer","darkKnightFinalStrike","divineBarrierDamage","engineerMechChoice","elementSatchelFlameDismantle","extraGemDeathTransfer","foresightDrawChoice","goldenMaskTarget","internetAddictionDodgeRequest","minerDigAtPlayEnd","minerNaturalExitTarget","minerSourceDismantle","owlCounterattack","purpleLordHeroBlade","qiBallDismantle","reforgeFurnaceSelection","sheepPhaseOneDodgeRequest","superBabyDodgeRequest","temporaryCoinImmediateUse","trapBombDetonation","triggerCardSelection","valkyrieBossResponse","weaponParticleEagleFollowUp","weaponW61Choice","wizardSpellStrike","redLordSealingHammer","statueCardSelection","statuePaladinResponse","statuePriestTake","statueKnightDuel","statueKnightWeapon","statueResolutionChoice","demolitionOptionalDiscard","demolitionWeaponOverflow"] as const;
const coreKinds=["playPhaseAction","discardPhaseAction","attackResponse","dyingRescue","judgmentDesignation","judgmentIntervention","preJudgment","optionalTrigger","triggerOrdering"] as const;
const expectedWindowKinds=new Set([...registryKinds,...coreKinds,"initialRedraw"]);

beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});

async function collectSourceWindowKinds():Promise<string[]>{
 const engineDir=resolve(import.meta.dirname,"../engine");
 const files=(await readdir(engineDir)).filter(file=>file.endsWith(".ts")&&!file.endsWith(".test.ts"));
 const collected=new Set<string>(["initialRedraw"]);
 for(const file of files){
  const lines=(await readFile(join(engineDir,file),"utf8")).split(/\r?\n/);
  const points:Array<{index:number;open:boolean}>=[];
  lines.forEach((line,index)=>{const open=/\bopenWindow\(/.test(line)&&!line.includes("function openWindow");if(line.includes("pendingWindows.push(")||line.includes("pendingWindows.unshift(")||open)points.push({index,open});});
  for(const point of points){
   const start=Math.max(0,point.index-12),end=Math.min(lines.length-1,point.index+12),block=lines.slice(start,end+1).join("\n");
   for(const match of block.matchAll(/kind\s*[:=]\s*"([A-Za-z0-9_]+)"/g))if(match[1]!=="character")collected.add(match[1]!);
   if(point.open)for(const match of block.matchAll(/openWindow\(\s*[^,]+,\s*"([A-Za-z0-9_]+)"/g))collected.add(match[1]!);
  }
 }
 return [...collected].sort();
}

function engineState(seed=101,firstSeat:Seat=1):AuthoritativeGameState{
 let state=createInitialSetup(ruleset,{gameId:`window-${seed}`,firstSeat,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});
 for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
 return state;
}

function makeRoom(state:AuthoritativeGameState):AppRoom{
 return{roomId:state.gameId,roomCode:"WINDOW",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};
}

function commitWithHistory(tx:EngineTransaction<AuthoritativeGameState>):AuthoritativeGameState{const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);return committed.state;}

function activeRedState():AuthoritativeGameState{
 let state=engineState(167);state.pendingWindows=[];
 const ref=Object.values(state.cards).find(card=>card.templateId==="boss.red_lord")!.cardRef,card=state.cards[ref]!,from=state.zones[card.zoneRef]!;
 from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);state.zones["boss:1"]!.orderedCardRefs.push(ref);Object.assign(card,{zoneRef:"boss:1",ownerSeat:1,controllerSeat:1,faceUp:true});
 const tx=new EngineTransaction(state);activateBossInTransaction(tx,ruleset,ref,"test");state=commitWithHistory(tx);
 const next=new EngineTransaction(state);onBossOwnerTurnStart(next,ruleset,1,900);return commitWithHistory(next);
}

function move(state:AuthoritativeGameState,ref:string,to:string,owner:Seat|null=null){const card=state.cards[ref]!,from=state.zones[card.zoneRef]!;from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);state.zones[to]!.orderedCardRefs.push(ref);Object.assign(card,{zoneRef:to,ownerSeat:owner,controllerSeat:owner,faceUp:!to.startsWith("hand:")});}

function statueState():AuthoritativeGameState{
 let state=engineState(827);Object.assign(state,{activeSeat:1,phase:"play",phaseBoundary:"body",phaseMode:"manual",phaseBodyResolved:false});state.pendingWindows=[];
 for(const seat of[1,2,3,4]as const)for(const ref of[...state.zones[`hand:${seat}`]!.orderedCardRefs])if(state.cards[ref]!.templateId.startsWith("statue.paladin."))move(state,ref,"drawPile");
 const card=Object.values(state.cards).find(item=>item.templateId.startsWith("statue.elf."))!,ref=card.cardRef;move(state,ref,"resolving");Object.assign(state.cards[ref]!.runtime,{statueOwnerSeat:1,statueResumePlayDeadlineAt:900});
 return beginStatueResolution(state,ruleset,ref,{targetRef:"character:2",deadlineAt:900}).state;
}

function foresightState():AuthoritativeGameState{
 let state=createInitialSetup(ruleset,{gameId:"window-foresight",firstSeat:1,seed:977,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.shaman",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});
 for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
 Object.assign(state,{activeSeat:1,phase:"draw",phaseBoundary:"body",phaseMode:"automatic",phaseBodyResolved:false});
 return resolvePhaseBody(state,ruleset,800).state;
}

describe("window coverage matrix",()=>{
 it("classifies every source-produced pending window kind",async()=>{
  const source=await collectSourceWindowKinds();
  expect(source.length).toBeGreaterThan(0);
  for(const kind of source)expect(expectedWindowKinds.has(kind)).toBe(true);
 });
 it("routes registry windows through windowRegistry and core windows through GameService",()=>{
  for(const kind of registryKinds)expect(supportsWindow(kind)).toBe(true);
  for(const kind of coreKinds)expect(supportsWindow(kind)).toBe(false);
 });
});

describe("new registry adapters",()=>{
 it("projects and executes red lord sealing hammer with independent melee and laser targets",()=>{
  const state=activeRedState(),room=makeRoom(state),projector=new GameProjector(ruleset),snapshot=projector.game(room,"u1");
  expect(validateProtocol("game",snapshot)).toEqual({ok:true});
  const window=room.game!.pendingWindows[0]!,activate=snapshot.interaction.offers.find(offer=>offer.offerId.includes(":activate:"))!;
  expect(window.kind).toBe("redLordSealingHammer");
  expect(activate.selectionSpecs).toEqual(expect.arrayContaining([expect.objectContaining({key:"meleeTarget",min:0,max:1}),expect.objectContaining({key:"laserTarget",min:0,max:1})]));
  const service=new GameService(ruleset,()=>1000),result=service.handle(room,users[1]!,{type:"GAME_COMMAND",commandId:"red-hammer-1",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:window.promptId,offerId:activate.offerId,command:"EXECUTE_OFFER",payload:{selections:{meleeTarget:["public:seat_2"],laserTarget:["public:seat_3"]}}});
  expect(result.accepted).toBe(true);expect(room.game!.combat.attack).toMatchObject({attackerSeat:1,targetRefs:["character:2","character:3"]});
  expect(validateProtocol("game",projector.game(room,"u1"))).toEqual({ok:true});
 });
 it("times out red lord sealing hammer by passing",()=>{
  const room=makeRoom(activeRedState()),service=new GameService(ruleset,()=>1000);
  expect(room.game!.pendingWindows[0]!.kind).toBe("redLordSealingHammer");
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.pendingWindows.some(window=>window.kind==="redLordSealingHammer")).toBe(false);
  expect(service.timeout(room)).toBe(false);
 });
});

describe("statue hidden selection projection",()=>{
 it("exposes concealed placeholders without leaking hidden card identity",()=>{
  const state=statueState(),room=makeRoom(state),snapshot=new GameProjector(ruleset).game(room,"u1") as any;
  expect(validateProtocol("game",snapshot)).toEqual({ok:true});
  const window=room.game!.pendingWindows[0]!,hiddenCount=Number(window.context?.hiddenCardCount??0);
  expect(window.kind).toBe("statueCardSelection");expect(hiddenCount).toBeGreaterThan(0);
  expect(snapshot.privateView.concealedChoices).toHaveLength(hiddenCount);
   const offers=snapshot.interaction.offers.filter((offer:any)=>offer.sourceRefs.length);
  expect(offers.length).toBeGreaterThan(0);
  for(const offer of offers as any[]){expect(offer.selectionSpecs).toHaveLength(0);expect(offer.sourceRefs[0]).toMatch(/^concealed:/);expect(offer.sourceRefs[0]).not.toMatch(/^private:|^public:card:/);}
 });
 it("executes a concealed statue choice through GameService",()=>{
  const state=statueState(),room=makeRoom(state),service=new GameService(ruleset,()=>1000),window=room.game!.pendingWindows[0]!,offer=window.legalOfferIds[1]!,ref=resolveWindowSelectionValues(window,[`concealed:${window.promptId}:1`])[0] as string;
  const result=service.handle(room,users[1]!,{type:"GAME_COMMAND",commandId:"statue-concealed-1",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:window.promptId,offerId:offer,command:"EXECUTE_OFFER",payload:{selections:{}}});
  expect(result.accepted).toBe(true);expect(room.game!.cards[ref]!.zoneRef).toBe("discardPile");expect(validateProtocol("game",new GameProjector(ruleset).game(room,"u1"))).toEqual({ok:true});
 });
 it("resolves mandatory statue selection timeout through the authoritative random source",()=>{
  const room=makeRoom(statueState()),service=new GameService(ruleset,()=>1000);
  const timeoutCount=()=>room.game!.randomHistory.filter(entry=>entry.purpose==="timeout.statueCardSelection").length;
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.pendingWindows.some(window=>window.kind==="statueCardSelection")).toBe(false);
  expect(timeoutCount()).toBe(1);
  service.timeout(room);
  expect(timeoutCount()).toBe(1);
 });
});

describe("private display projection",()=>{
 it("keeps foresight display cards out of other viewers snapshots",()=>{
  const room=makeRoom(foresightState()),projector=new GameProjector(ruleset),owner=projector.game(room,"u1") as any,other=projector.game(room,"u2") as any;
  expect(validateProtocol("game",owner)).toEqual({ok:true});expect(validateProtocol("game",other)).toEqual({ok:true});
  expect(owner.interaction.offers[0]?.selectionSpecs[0]).toMatchObject({key:"cards",min:2,max:2});
  expect(owner.interaction.offers[0]!.selectionSpecs[0]!.legalRefs!.every((ref:string)=>ref.startsWith("private:u1:"))).toBe(true);
  expect(other.interaction.prompt).toBeNull();expect(other.interaction.offers).toHaveLength(0);expect(other.privateView.concealedChoices).toHaveLength(0);expect(other.publicView.centralCards).toHaveLength(0);
 });
});
