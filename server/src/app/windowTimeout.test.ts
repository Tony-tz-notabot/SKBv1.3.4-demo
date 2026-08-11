import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,PendingWindowState,Seat} from "../engine/state.js";
import {GameService} from "./gameService.js";
import {openTemporaryCoinChoiceAfterHit} from "../engine/coinGun.js";
import {openBombDetonation} from "../engine/trapMaster.js";
import {EngineTransaction} from "../engine/transaction.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"超时",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function engineState(seed=331,seat1="character.wizard"):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`timeout-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:seat1,2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}
function moveCard(state:AuthoritativeGameState,cardRef:string,toZoneRef:string,owner:Seat=1){const card=state.cards[cardRef]!,from=state.zones[card.zoneRef]!,index=from.orderedCardRefs.indexOf(cardRef);if(index<0)throw new Error("card not in source zone");from.orderedCardRefs.splice(index,1);const to=state.zones[toZoneRef]!;to.orderedCardRefs.push(cardRef);card.zoneRef=toZoneRef;card.ownerSeat=to.ownerSeat??owner;card.controllerSeat=to.ownerSeat??owner;card.faceUp=!toZoneRef.startsWith("hand:");}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"TO",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}

describe("window timeout coverage",()=>{
 it("provides a timeout path for the previously uncovered registry windows",async()=>{
  const source=await readFile(resolve(import.meta.dirname,"../../../server/src/app/windowRegistry.ts"),"utf8");
  expect(source).toContain("handleTimeout");expect(source).toContain("timeoutPolicy===\"randomLegal\"");
  for(const kind of["engineerMechChoice","qiBallDismantle","temporaryCoinImmediateUse","trapBombDetonation","wizardSpellStrike"]){
   expect(source,kind).toMatch(new RegExp(`${kind}:standard\\(`));
  }
 });
 it("times out a pass-policy wizard spell strike window by passing even when legal cards exist",()=>{
  let state=engineState(332,"character.wizard");const cards=[...state.zones["hand:1"]!.orderedCardRefs];expect(cards.length).toBeGreaterThan(0);
  state.pendingWindows=[{promptId:"prompt:wss:1",kind:"wizardSpellStrike",prioritySeat:1,mandatory:false,deadlineAt:1,timeoutPolicy:"pass",legalOfferIds:["offer:wizard-spell-strike:pass","offer:wizard-spell-strike:activate"],context:{attackId:"a:1",targetRef:"character:2",legalCardRefs:cards}}];
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  expect(room.game!.pendingWindows[0]!.kind).toBe("wizardSpellStrike");
  const result=service.timeout(room);
  expect(result,"pass 超时不得携带卡牌选择（否则 Session 以 COST_SELECTION_INVALID 拒绝，窗口永不推进）").toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="wizardSpellStrike")).toBe(false);
 });
 it("times out a random-legal engineer mech choice through the authoritative random source",()=>{
  let state=engineState(333,"character.engineer");state.players.find(p=>p.seat===1)!.markers["engineer.mechActive"]=true;state.players.find(p=>p.seat===1)!.markers["engineer.mechKind"]="prototype";
  state.pendingWindows=[{promptId:"prompt:mech:1",kind:"engineerMechChoice",prioritySeat:1,mandatory:true,deadlineAt:1,timeoutPolicy:"randomLegal",legalOfferIds:["offer:engineer-mech:prototype","offer:engineer-mech:vitaminC"],context:{}}];
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000),before=room.game!.randomHistory.length;
  const result=service.timeout(room);
  expect(result).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="engineerMechChoice")).toBe(false);
  expect(room.game!.randomHistory.length).toBeGreaterThan(before);
 });
 it("advances a real temporary coin window produced by a w66 hit",()=>{
  let state=engineState(350,"character.trap_master");state.combat.attack={attackId:"attack:1:1",attackerSeat:1,weaponId:"weapon.w66",status:"targetHit",currentTargetHit:true} as never;state.combat.currentTargetRef="character:2";
  const opened=openTemporaryCoinChoiceAfterHit({previousRevision:state.stateRevision,state,events:[]} as never,1);state=opened.state;
  expect(state.pendingWindows[0]!.kind).toBe("temporaryCoinImmediateUse");
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);expect(service.timeout(room)).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="temporaryCoinImmediateUse")).toBe(false);
 });
 it("advances a real bomb detonation window from trap bombs",()=>{
  let state=engineState(351,"character.trap_master");state.players.find(p=>p.seat===1)!.markers["trap.bombs"]=2;
  const tx=new EngineTransaction(state);openBombDetonation(tx,1,1);state=tx.commit().state;
  expect(state.pendingWindows[0]!.kind).toBe("trapBombDetonation");
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);expect(service.timeout(room)).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="trapBombDetonation")).toBe(false);
 });
 it("advances qi ball dismantle, temporary coin and bomb detonation windows on timeout",()=>{
  let state=engineState(341,"character.trap_master");const weaponCard=Object.values(state.cards).find(card=>card.templateId.startsWith("weapon."))!;moveCard(state,weaponCard.cardRef,"weapon:1:2",2);
  state.pendingWindows=[{promptId:"prompt:qbd:1",kind:"qiBallDismantle",prioritySeat:1,mandatory:true,deadlineAt:1,timeoutPolicy:"randomLegal",legalOfferIds:["offer:qi-ball-dismantle"],context:{targetSeat:2,legalCardRefs:[weaponCard.cardRef]}}];
  let room=makeRoom(state),service=new GameService(ruleset,()=>1000);const serviceResult=service.timeout(room);expect(serviceResult).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="qiBallDismantle")).toBe(false);expect(room.game!.zones.discardPile!.orderedCardRefs).toContain(weaponCard.cardRef);
  let coin=engineState(342,"character.trap_master");coin.pendingWindows=[{promptId:"prompt:tc:1",kind:"temporaryCoinImmediateUse",prioritySeat:1,mandatory:false,deadlineAt:1,timeoutPolicy:"pass",legalOfferIds:["offer:temporary-coin:use","offer:temporary-coin:pass"],context:{targetRef:"character:2"}}];
  room=makeRoom(coin);service=new GameService(ruleset,()=>1000);expect(()=>service.timeout(room),"temporaryCoin").not.toThrow();
  let bomb=engineState(343,"character.trap_master");bomb.pendingWindows=[{promptId:"prompt:bd:1",kind:"trapBombDetonation",prioritySeat:1,mandatory:false,deadlineAt:1,timeoutPolicy:"pass",legalOfferIds:["offer:trap-detonation:pass","offer:trap-detonation:card:1"],context:{bombs:1}}];
  room=makeRoom(bomb);service=new GameService(ruleset,()=>1000);expect(service.timeout(room)).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="trapBombDetonation")).toBe(false);
 });
});
