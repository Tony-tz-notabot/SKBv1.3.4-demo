import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameService} from "./gameService.js";
import {GameProjector} from "./projection.js";
import {playOffers,type RawPlayOffer} from "./playRegistry.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"元素锦囊",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function openedState(seed=501):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`satchel-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.ancient_elementalist",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;const scheduled=runAutomaticScheduler(state,ruleset,()=>21000);state=scheduled.state;if(state.phase!=="play")throw new Error(`expected play phase, got ${state.phase}`);return state;}
function moveCard(state:AuthoritativeGameState,cardRef:string,toZoneRef:string,owner:Seat){const card=state.cards[cardRef]!,from=state.zones[card.zoneRef]!,index=from.orderedCardRefs.indexOf(cardRef);if(index<0)throw new Error("card not in source zone");from.orderedCardRefs.splice(index,1);const to=state.zones[toZoneRef]!;to.orderedCardRefs.push(cardRef);card.zoneRef=toZoneRef;card.ownerSeat=to.ownerSeat??owner;card.controllerSeat=to.ownerSeat??owner;card.faceUp=!toZoneRef.startsWith("hand:");}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"SAT",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function refsByTemplate(state:AuthoritativeGameState,prefix:string):string[]{return Object.values(state.cards).filter(card=>card.templateId.startsWith(prefix)).map(card=>card.cardRef);}
function snapshotValid(room:AppRoom,userId:string){expect(validateProtocol("game",new GameProjector(ruleset).game(room,userId))).toEqual({ok:true});}

describe("元素锦囊出牌报价（每锦囊一个、点击后选目标）",()=>{
 it("三个锦囊各产生一个报价，各自带合法目标与 targets 选择规格",()=>{
  let state=openedState(501);
  const offers=playOffers(state,ruleset,1,"u1",()=>Date.now()+20000).filter(o=>o.offerId.includes("element_satchel"));
  expect(offers.length,"应恰好 3 个锦囊报价（当前按锦囊×目标展开了多个）").toBe(3);
  const modes=offers.map(o=>(o as any).mode).sort();
  expect(modes).toEqual(["electrified","flame","frozen"]);
  for(const o of offers){
    expect((o as any).legalTargetRefs?.length,"每个锦囊报价应带合法目标列表").toBeGreaterThan(0);
    expect((o as any).targetMin).toBe(1);
    expect((o as any).targetMax).toBe(1);
  }
 });
 it("点锦囊报价后需选目标：提交 selections.targets 生效",()=>{
  let state=openedState(502);
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  const allOffers=playOffers(room.game!,ruleset,1,"u1",()=>Date.now()+20000);console.log("DBG502 offers:",allOffers.map(o=>o.offerId).join(","));const raw=allOffers.find(o=>o.offerId.endsWith(":frozen"))!;
  const command={type:"GAME_COMMAND" as const,commandId:"satchel-frozen",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:room.game!.pendingWindows[0]!.promptId,offerId:raw.offerId,command:"EXECUTE_OFFER" as const,payload:{selections:{targets:["public:seat_2"]}}};
  const out=service.handle(room,users[1]!,command);
  expect(out.accepted,`frozen 锦囊执行被拒:${JSON.stringify(out)}`).toBe(true);
  expect(room.game!.players.find(p=>p.seat===2)!.statuses.some(s=>s.statusId==="status.frozen")).toBe(true);
  expect(room.game!.players.find(p=>p.seat===1)!.markers["elementSatchel.used.frozen"]).toBe(true);
  snapshotValid(room,"u1");
 });
 it("烈焰锦囊两阶段：提交目标后开拆牌窗口，跨目标/越界选牌被拒且零污染，合法拆牌生效",()=>{
  let state=openedState(503);
  const card2=Object.values(state.cards).find(c=>c.zoneRef==="drawPile")!.cardRef;
  moveCard(state,card2,"hand:2",2);
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  const raw=playOffers(room.game!,ruleset,1,"u1",()=>Date.now()+20000).find(o=>o.offerId.endsWith(":flame"))!;
  const first=service.handle(room,users[1]!,{type:"GAME_COMMAND",commandId:"flame-first",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:room.game!.pendingWindows[0]!.promptId,offerId:raw.offerId,command:"EXECUTE_OFFER",payload:{selections:{targets:["public:seat_2"]}}});
  expect(first.accepted,`第一阶段(选目标)被拒:${JSON.stringify(first)}`).toBe(true);
  const win=room.game!.pendingWindows.find(w=>w.kind==="elementSatchelFlameDismantle");
  expect(win,"烈焰应打开拆牌窗口").toBeTruthy();
  const legal=win!.context!.legalCardRefs as string[];
  expect(legal).toContain(card2);
  // 越界 concealed（不属于目标2合法牌）→ 拒绝且零污染
  const before=room.game!.stateRevision;
  const bad=service.handle(room,users[1]!,{type:"GAME_COMMAND",commandId:"flame-bad",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:win!.promptId,offerId:"offer:element-satchel-flame:dismantle",command:"EXECUTE_OFFER",payload:{selections:{cards:[`concealed:${win!.promptId}:9`]}}});
  expect(bad.accepted,`跨目标选牌应被拒:${JSON.stringify(bad)}`).toBe(false);
  expect(room.game!.stateRevision).toBe(before);
  expect(room.game!.players.find(p=>p.seat===1)!.markers["elementSatchel.used.flame"]).toBeUndefined();
  // 合法：拆目标2的牌
  const good=service.handle(room,users[1]!,{type:"GAME_COMMAND",commandId:"flame-good",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:win!.promptId,offerId:"offer:element-satchel-flame:dismantle",command:"EXECUTE_OFFER",payload:{selections:{cards:[`concealed:${win!.promptId}:0`]}}});
  expect(good.accepted,`合法拆牌被拒:${JSON.stringify(good)}`).toBe(true);
  expect(room.game!.zones.discardPile!.orderedCardRefs).toContain(card2);
  expect(room.game!.players.find(p=>p.seat===1)!.markers["elementSatchel.used.flame"]).toBe(true);
  snapshotValid(room,"u1");
 });
});
