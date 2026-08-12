import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import {setWeaponPreselection} from "../engine/preselection.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameService} from "./gameService.js";
import {GameProjector} from "./projection.js";
import {playOffers,type RawPlayOffer} from "./playRegistry.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"近战格挡",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function openedState(seed=401):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`melee-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;const scheduled=runAutomaticScheduler(state,ruleset,()=>21000);state=scheduled.state;if(state.phase!=="play")throw new Error(`expected play phase, got ${state.phase}`);return state;}
function moveCard(state:AuthoritativeGameState,cardRef:string,toZoneRef:string,owner:Seat){const card=state.cards[cardRef]!,from=state.zones[card.zoneRef]!,index=from.orderedCardRefs.indexOf(cardRef);if(index<0)throw new Error("card not in source zone");from.orderedCardRefs.splice(index,1);const to=state.zones[toZoneRef]!;to.orderedCardRefs.push(cardRef);card.zoneRef=toZoneRef;card.ownerSeat=to.ownerSeat??owner;card.controllerSeat=to.ownerSeat??owner;card.faceUp=!toZoneRef.startsWith("hand:");}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"MELEE",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function refsByTemplate(state:AuthoritativeGameState,prefix:string):string[]{return Object.values(state.cards).filter(card=>card.templateId.startsWith(prefix)).map(card=>card.cardRef);}
function snapshotValid(room:AppRoom,userId:string){expect(validateProtocol("game",new GameProjector(ruleset).game(room,userId))).toEqual({ok:true});}
function submit(room:AppRoom,service:GameService,userId:string,offerId:string,selections:Record<string,Array<string|number|boolean>>,commandId:string){const window=room.game!.pendingWindows.find(w=>w.prioritySeat===room.game!.players.find(p=>p.userId===userId)!.seat)??room.game!.pendingWindows[0]!;const before=room.game!.stateRevision,command={type:"GAME_COMMAND",commandId,gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:window.promptId,offerId,command:"EXECUTE_OFFER",payload:{selections}};const first=service.handle(room,users[Number(userId.slice(1)) as Seat]!,command);expect(first.accepted,`命令 ${commandId} 被拒:${JSON.stringify(first)}`).toBe(true);expect(room.game!.stateRevision).toBeGreaterThan(before);snapshotValid(room,userId);return first;}

describe("近战格挡全链路（攻击→响应窗口→装备区近战武器格挡）",()=>{
 it("远程武器攻击产生含 meleeBlock 的响应窗口，目标可用装备区近战武器格挡",()=>{
  let state=openedState(401);
  const ranged=refsByTemplate(state,"weapon.w01")[0]!,melee=refsByTemplate(state,"weapon.w02")[0]!,kill=refsByTemplate(state,"basic.kill.")[0]!;
  moveCard(state,ranged,"weapon:1:1",1);moveCard(state,kill,"hand:1",1);moveCard(state,melee,"weapon:1:2",2);
  state=setWeaponPreselection(state,1,"weapon:1:1",null,ruleset).state;
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  // 1) 攻击方发起攻击（远程 w01 → seat2）
  const attackOffer=playOffers(room.game!,ruleset,1,"u1",()=>Date.now()+20000).find(o=>o.offerId.includes("attack"));
  expect(attackOffer,`无攻击报价:${playOffers(room.game!,ruleset,1,"u1",()=>Date.now()+20000).map(o=>o.offerId).join(",")}`).toBeTruthy();
  submit(room,service,"u1",attackOffer!.offerId,{killCards:[`private:u1:${kill}`],targets:["public:seat_2"]},"attack-401");
  // 2) 响应窗口到达 seat2
  const w=room.game!.pendingWindows[0]!;
  expect(w.kind).toBe("attackResponse");expect(w.prioritySeat).toBe(2);
  // 3) 投影：meleeBlock 报价存在且合法卡是装备区近战武器（public 引用）
  const snap=new GameProjector(ruleset).game(room,"u2") as any;
  const blockOffer=(snap.interaction.offers as any[]).find((o:any)=>o.offerId.includes(":meleeBlock:"));
  expect(blockOffer,`无 meleeBlock 报价:${(snap.interaction.offers as any[]).map((o:any)=>o.offerId).join(",")}`).toBeTruthy();
  const cardsSpec=(blockOffer.selectionSpecs as any[]).find((s:any)=>s.kind==="cards");
  expect(cardsSpec!.legalRefs).toContain(`public:${melee}`);
  // 4) 目标用装备区近战武器格挡 → accepted，攻击未命中且自身无伤
  const hpBefore=room.game!.players.find(p=>p.seat===2)!.hp,shieldBefore=room.game!.players.find(p=>p.seat===2)!.shield;
  submit(room,service,"u2",blockOffer.offerId,{cards:[`public:${melee}`]},"melee-block-401");
  expect(room.game!.players.find(p=>p.seat===2)!.hp).toBe(hpBefore);
  expect(room.game!.players.find(p=>p.seat===2)!.shield).toBe(shieldBefore);
  expect(room.game!.combat.attack,`格挡后攻击应已结束:${JSON.stringify(room.game!.combat)}`).toBeNull();
  expect(room.game!.history.domainEvents.some(e=>e.eventType==="attack.miss")).toBe(true);
  expect(room.game!.zones[`weapon:1:2`]!.orderedCardRefs,"格挡不消耗装备区武器").toContain(melee);
  expect(room.game!.pendingWindows[0]!.kind).toBe("playPhaseAction");
 });
 it("近战攻击（不可格挡）的响应窗口不提供 meleeBlock 报价，但仍可出闪",()=>{
  let state=openedState(402);
  const melee=refsByTemplate(state,"weapon.w02")[0]!,kill=refsByTemplate(state,"basic.kill.")[0]!,dodge=refsByTemplate(state,"basic.dodge.")[0]!;
  moveCard(state,melee,"weapon:1:1",1);moveCard(state,kill,"hand:1",1);moveCard(state,dodge,"hand:2",2);
  state=setWeaponPreselection(state,1,"weapon:1:1",null,ruleset).state;
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  const attackOffer=playOffers(room.game!,ruleset,1,"u1",()=>Date.now()+20000).find(o=>o.offerId.includes("attack"));
  submit(room,service,"u1",attackOffer!.offerId,{killCards:[`private:u1:${kill}`],targets:["public:seat_2"]},"attack-402");
  const w=room.game!.pendingWindows[0]!;
  expect(w.kind).toBe("attackResponse");
  const snap=new GameProjector(ruleset).game(room,"u2") as any;
  expect((snap.interaction.offers as any[]).some((o:any)=>o.offerId.includes(":meleeBlock:")),"近战攻击不应可被近战格挡").toBe(false);
  expect((snap.interaction.offers as any[]).some((o:any)=>o.offerId.includes(":dodge:"))).toBe(true);
 });
});
