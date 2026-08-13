import {beforeAll,describe,expect,it} from "vitest";
import {resolve} from "node:path";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {activateBossInTransaction} from "../engine/bossLifecycle.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {EngineTransaction} from "../engine/transaction.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

// BUG-4 复现：将军（seat1）装备并激活暗黑大骑士（装备失效/攻击次数清零）后，
// round2 将军出牌阶段，投影该座产出 interaction.offers 含 `createBlackSword`/`blackSwordAttack`
// 两个未列入协议 InteractionOffer.kind 枚举的 kind → 客户端 Ajv 拒收整条 GAME_SNAPSHOT
// → 仅该座快照不再更新（sync/broadcast 无按座 try/catch，其余座正常）。修复为枚举补全。

let ruleset:LoadedRuleset;

const settings:AppSettings={roomName:"暗黑大骑士静滞复现",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一号"},2:{userId:"u2",displayName:"二号"},3:{userId:"u3",displayName:"三号"},4:{userId:"u4",displayName:"四号"}};

beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});

function engineState(seed:number,firstSeat:Seat=1):AuthoritativeGameState{
 let state=createInitialSetup(ruleset,{gameId:`darkknight-${seed}`,firstSeat,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.general",2:"character.knight",3:"character.paladin",4:"character.ranger"}});
 for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
 return state;
}

function makeRoom(state:AuthoritativeGameState):AppRoom{
 return{roomId:state.gameId,roomCode:"STASIS",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};
}

function commitWithHistory(tx:EngineTransaction<AuthoritativeGameState>):AuthoritativeGameState{const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);return committed.state;}

// 构造：seat1 将军装备并激活 boss.dark_grand_knight，round2 出牌阶段正文（playPhaseAction@1 finish 窗口）。
// withBlackSwords=true 时给将军 1 把黑剑，让黑剑攻击报价（含目标选择）也进入投影。
function bossActiveGeneralPlayState(seed=701,withBlackSwords=false):AuthoritativeGameState{
 let state=engineState(seed);state.pendingWindows=[];
 const ref=Object.values(state.cards).find(card=>card.templateId==="boss.dark_grand_knight")!.cardRef,card=state.cards[ref]!,from=state.zones[card.zoneRef]!;
 from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);state.zones["boss:1"]!.orderedCardRefs.push(ref);Object.assign(card,{zoneRef:"boss:1",ownerSeat:1,controllerSeat:1,faceUp:true});
 const tx=new EngineTransaction(state);activateBossInTransaction(tx,ruleset,ref,"test");state=commitWithHistory(tx);
 if(withBlackSwords)state.players.find(player=>player.seat===1)!.markers["darkKnight.blackSword"]=1;
 Object.assign(state,{round:2,activeSeat:1,phase:"play",phaseBoundary:"body",phaseMode:"manual",phaseBodyResolved:false});state.pendingWindows=[];
 state.pendingWindows=[{promptId:"prompt:playPhaseAction:2:1:800",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}}];
 return state;
}

describe("暗黑大骑士静滞单座卡死（BUG-4）",()=>{
 it("投影将军座（激活暗黑大骑士的出牌阶段）含制造黑剑报价且过协议校验",()=>{
  const state=bossActiveGeneralPlayState(),room=makeRoom(state);
  const snapshot=new GameProjector(ruleset).game(room,"u1") as any;
  const kinds=snapshot.interaction.offers.map((offer:any)=>offer.kind);
  expect(kinds).toContain("createBlackSword");
  expect(validateProtocol("game",snapshot)).toEqual({ok:true});
 });
 it("有黑剑时投影黑剑攻击报价（带目标选择）且过协议校验",()=>{
  const state=bossActiveGeneralPlayState(702,true),room=makeRoom(state);
  const snapshot=new GameProjector(ruleset).game(room,"u1") as any;
  const attack=snapshot.interaction.offers.find((offer:any)=>offer.kind==="blackSwordAttack");
  expect(attack).toBeTruthy();
  expect(attack.selectionSpecs.some((spec:any)=>spec.key==="targets")).toBe(true);
  expect(validateProtocol("game",snapshot)).toEqual({ok:true});
 });
 it("其余座投影同样过协议校验",()=>{
  const state=bossActiveGeneralPlayState(703,true),room=makeRoom(state);
  for(const seat of[2,3,4]as const)expect(validateProtocol("game",new GameProjector(ruleset).game(room,`u${seat}`))).toEqual({ok:true});
 });
});

// 回归网：全角色出牌阶段投影扫描。BUG-4 的成因是 playOffer 直通 raw.kind，
// 产生未列入 InteractionOffer.kind 枚举的 offer kind，导致该座快照被客户端拒收。
// 此扫描对每个角色构造出牌窗口并投影，断言不抛异常、协议合法、且每个 offer kind 都在枚举内。
const enumOfferKinds=new Set<string>();
beforeAll(async()=>{
 const {readFileSync}=await import("node:fs");
 const schema=JSON.parse(readFileSync(resolve(import.meta.dirname,"../../../protocol/v1.3.4/client-protocol.schema.json"),"utf8"));
 for(const kind of (schema.$defs.InteractionOffer.properties.kind.enum as string[]))enumOfferKinds.add(kind);
});

describe("全角色出牌阶段投影 offer kind 扫描（防同类静滞卡死）",()=>{
 const characterIds=["character.knight","character.alchemist","character.headtaker","character.werewolf","character.paladin","character.elf","character.ranger","character.taoist","character.priest","character.punching_bag","character.interdimensional_traveler","character.ancient_elementalist","character.miner","character.demonmancer","character.necromancer","character.robot","character.assassin","character.wizard","character.qi_master","character.trap_master","character.engineer","character.druid","character.berserker","character.shaman","character.general"];
 it.each(characterIds)("%s 出牌阶段投影不抛异常且所有 offer kind 在协议枚举内",(characterId)=>{
  let state=createInitialSetup(ruleset,{gameId:`sweep-${characterId}`,firstSeat:1,seed:9001,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:characterId as never,2:"character.knight",3:"character.paladin",4:"character.ranger"}});
  for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
  Object.assign(state,{round:1,activeSeat:1,phase:"play",phaseBoundary:"body",phaseMode:"manual",phaseBodyResolved:false});state.pendingWindows=[];
  state.pendingWindows=[{promptId:"prompt:playPhaseAction:1:1:800",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}}];
  const snapshot=new GameProjector(ruleset).game(makeRoom(state),"u1") as any;
  expect(validateProtocol("game",snapshot)).toEqual({ok:true});
  for(const offer of snapshot.interaction.offers as Array<{offerId:string;kind:string}>)
    expect(enumOfferKinds.has(offer.kind),`${offer.offerId} 的 kind 不在枚举内: ${offer.kind}`).toBe(true);
 });
});
