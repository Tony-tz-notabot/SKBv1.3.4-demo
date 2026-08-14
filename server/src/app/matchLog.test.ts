import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameProjector} from "./projection.js";
import {initGameLog,MatchLogBuilder,projectLogView,type LogEntry,type MatchLogFile,type MatchLogSink} from "./matchLog.js";
import type {JsonValue} from "../engine/types.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

// 对局日志：构建器映射（原子/摘要）、隐私作用域、按观众投影折叠、文件落盘。

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"日志测试",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
class FakeSink implements MatchLogSink{saved:MatchLogFile[]=[];async save(gameId:string,payload:MatchLogFile){this.saved.push(payload)}}
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function engineState(seed=501):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`matchlog-${seed}`,firstSeat:1,seed,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.ranger",3:"character.paladin",4:"character.wizard"}});for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"MLOG",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function rig(state:AuthoritativeGameState){const room=makeRoom(state);room.gameLog=initGameLog(room);const sink=new FakeSink();const builder=new MatchLogBuilder(ruleset,sink);builder.sync(room);return{room,sink,builder};}
function push(state:AuthoritativeGameState,eventType:string,payload:Record<string,JsonValue>){state.lastEventSeq+=1;state.history.domainEvents.push({eventType,payload,eventSeq:state.lastEventSeq,stateRevision:state.stateRevision});}
const joined=(e:LogEntry)=>e.tokens.map(t=>t.t==="card"?`【${t.templateId}】`:t.t==="char"?`#${t.seat}#`:t.t==="ability"?`<${t.id}>`:t.s).join("");

describe("对局日志构建与隐私",()=>{
 it("开局事件入日志：game.start 原子 + turn.start 摘要分隔行，整局无「你」",()=>{
  const {room}=rig(engineState());
  const entries=room.gameLog!.entries;
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.some(e=>e.type==="game.start"&&e.mode==="atomic")).toBe(true);
  expect(entries.some(e=>e.type==="turn.start"&&e.mode==="summary")).toBe(true);
  expect(entries.some(e=>e.type==="phase.start")).toBe(true);
  expect(JSON.stringify(entries)).not.toContain("你");
 });
 it("摸牌隐私：本人见牌名、他人折叠为 N张牌、观战折叠",()=>{
  const state=engineState();
  state.cards["card:c1"]={cardRef:"card:c1",templateId:"support.potion",zoneRef:"hand:1",ownerSeat:1,controllerSeat:1,faceUp:true,runtime:{}};
  state.zones["hand:1"]!.orderedCardRefs.push("card:c1");
  push(state,"card.drawn",{seat:1,cardRefs:["card:c1"],requestedCount:1,actualCount:1});
  const {room}=rig(state);
  const draw=room.gameLog!.entries.find(e=>e.type==="card.drawn"&&e.mode==="atomic")!;
  expect(joined(draw)).toContain("#1#摸到【support.potion】");
  const cardToken=draw.tokens.find(t=>t.t==="card");
  expect(cardToken&&"scope" in cardToken?cardToken.scope:null).toBe("hand:1");
  expect(joined(projectLogView([draw],1)![0]!)).toContain("【support.potion】");
  expect(joined(projectLogView([draw],2)![0]!)).toContain("摸到1张牌");
  expect(projectLogView([draw],2)![0]!.tokens.some(t=>t.t==="card")).toBe(false);
  expect(joined(projectLogView([draw],null)![0]!)).toContain("摸到1张牌");
 });
 it("攻击摘要聚合：declare→weapon→target.after → 用【武器】攻击命中，护盾-1血-1；攻击消耗牌不产生摘要行",()=>{
  const state=engineState();
  state.cards["card:w"]={cardRef:"card:w",templateId:"weapon.w08",zoneRef:"weapon:1:1",ownerSeat:1,controllerSeat:1,faceUp:true,runtime:{}};
  push(state,"attack.declare",{attackId:"a1",attackerSeat:1});
  push(state,"attack.weapon.resolve",{attackId:"a1",kind:"weapon",weaponRef:"card:w",modeId:"default"});
  push(state,"attack.targeted",{attackId:"a1",targetRefs:["character:3"]});
  push(state,"card.played",{cardRef:"card:k",seat:1,purpose:"attack.killCost"}); // 攻击消耗杀，摘要应折叠
  push(state,"attack.target.after",{attackId:"a1",targetRef:"character:3",attackerSeat:1,sourceRef:"card:w",attackTypes:["ranged"],hit:true,actualDamage:2,actualHpLoss:1,actualShieldLoss:1,actualSpecialLayerLoss:0});
  const {room}=rig(state);
  const entries=room.gameLog!.entries;
  const summary=entries.find(e=>e.type==="attack.target.after"&&e.mode==="summary")!;
  const text=joined(summary);
  expect(text).toContain("#1#");
  expect(text).toContain("用【weapon.w08】");
  expect(text).toContain("攻击");
  expect(text).toContain("#3#");
  expect(text).toContain("命中");
  expect(text).toContain("护盾-1");
  expect(text).toContain("血-1");
  expect(entries.filter(e=>e.mode==="summary"&&e.type==="card.played")).toHaveLength(0);
  // 原子模式含攻击各阶段
  expect(entries.some(e=>e.type==="attack.declare")).toBe(true);
  expect(entries.some(e=>e.type==="attack.weapon.resolve")).toBe(true);
  expect(entries.some(e=>e.type==="card.played")).toBe(true);
 });
 it("攻击未命中 → 摘要未命中",()=>{
  const state=engineState();
  state.cards["card:w"]={cardRef:"card:w",templateId:"weapon.w08",zoneRef:"weapon:1:1",ownerSeat:1,controllerSeat:1,faceUp:true,runtime:{}};
  push(state,"attack.declare",{attackId:"a2",attackerSeat:1});
  push(state,"attack.weapon.resolve",{attackId:"a2",kind:"weapon",weaponRef:"card:w",modeId:"default"});
  push(state,"attack.target.after",{attackId:"a2",targetRef:"character:3",attackerSeat:1,sourceRef:"card:w",attackTypes:["ranged"],hit:false,actualDamage:0,actualHpLoss:0,actualShieldLoss:0,actualSpecialLayerLoss:0});
  const {room}=rig(state);
  const summary=room.gameLog!.entries.find(e=>e.type==="attack.target.after"&&e.mode==="summary")!;
  expect(joined(summary)).toContain("未命中");
 });
 it("受伤/恢复/状态/濒死/胜负各生成条目，水印推进且 seq 严格递增",()=>{
  const state=engineState();
  push(state,"health.hpLost",{seat:3,amount:2,attackId:"a",segmentId:"s"});
  push(state,"shield.shieldLost",{seat:3,amount:1,attackId:"a",segmentId:"s"});
  push(state,"hp.recovered",{seat:3,amount:2,sourceRef:"card:p"});
  push(state,"status.applied",{ownerSeat:3,statusId:"status.frozen",sourceSeat:1,result:"applied"});
  push(state,"dying.enter",{attackId:"a",targetRef:"character:3",reason:"hp"});
  push(state,"dying.rescued",{dyingRef:"character:3",rescuerSeat:2,hp:1,sourceRef:"card:r"});
  const {room}=rig(state);
  const log=room.gameLog!;
  expect(log.lastLogEventSeq).toBe(state.lastEventSeq);
  const seqs=log.entries.map(e=>e.seq);
  expect([...seqs].sort((a,b)=>a-b)).toEqual(seqs);
  expect(new Set(seqs).size).toBe(seqs.length);
  const all=log.entries.map(joined).join("");
  expect(all).toContain("失去");
  expect(all).toContain("获得状态【status.frozen】");
  expect(all).toContain("濒死");
  expect(all).toContain("救援");
  expect(log.entries.find(e=>e.type==="health.hpLost")!.tokens.some(t=>t.t==="sem"&&t.s==="2"&&t.cls==="sem-hp")).toBe(true);
  expect(log.entries.find(e=>e.type==="shield.shieldLost")!.tokens.some(t=>t.t==="sem"&&t.s==="1"&&t.cls==="sem-shield")).toBe(true);
  expect(log.entries.find(e=>e.type==="hp.recovered")!.tokens.some(t=>t.t==="sem"&&t.s==="2"&&t.cls==="sem-heal")).toBe(true);
 });
 it("胜利写文件：finalized 置位、文件含 summary/atomic/events 与 winnerTeam；重复 sync 不重复写",()=>{
  const state=engineState();
  state.lifecycle="ended";state.winnerTeam="A";
  push(state,"game.victory",{winnerTeam:"A"});
  const {room,sink,builder}=rig(state);
  expect(room.gameLog!.finalized).toBe(true);
  expect(sink.saved.length).toBe(1);
  const file=sink.saved[0]!;
  expect(file.winnerTeam).toBe("A");
  expect(file.summary.length).toBeGreaterThan(0);
  expect(file.atomic.length).toBeGreaterThan(0);
  expect(file.events.length).toBe(state.history.domainEvents.length);
  expect(file.players[0]).toMatchObject({seat:1,userId:"u1",displayName:"一",characterId:"character.knight",team:"A"});
  builder.sync(room); // 幂等
  expect(sink.saved.length).toBe(1);
 });
 it("强制中止写文件：game.aborted 条目 + forfeited",()=>{
  const state=engineState();
  state.lifecycle="ended";state.forfeited=true;state.forfeitedBySeat=1;
  push(state,"game.aborted",{bySeat:1});
  const {room,sink}=rig(state);
  expect(room.gameLog!.entries.some(e=>e.type==="game.aborted")).toBe(true);
  expect(sink.saved[0]!.forfeited).toBe(true);
  expect(sink.saved[0]!.forfeitedBySeat).toBe(1);
 });
 it("GAME_SNAPSHOT 含 log 且协议校验通过",()=>{
  const state=engineState();
  const realTpl=Object.values(state.cards)[0]!.templateId;
  state.cards["card:c1"]={cardRef:"card:c1",templateId:realTpl,zoneRef:"hand:1",ownerSeat:1,controllerSeat:1,faceUp:true,runtime:{}};
  state.zones["hand:1"]!.orderedCardRefs.push("card:c1");
  push(state,"card.drawn",{seat:1,cardRefs:["card:c1"],requestedCount:1,actualCount:1});
  const {room}=rig(state);
  const snap=new GameProjector(ruleset).game(room,users[1]!.userId);
  expect(Array.isArray((snap as any).log)).toBe(true);
  expect(validateProtocol("game",snap)).toEqual({ok:true});
 });
});
