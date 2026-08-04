import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {resolveInitialRedraw} from "../engine/setup.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {GameProjector,lobbyProjection,roomProjection} from "./projection.js";
import {validateProtocol} from "./protocol.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function service(){const dir=await mkdtemp(join(tmpdir(),"skb-app-"));dirs.push(dir);return new RoomService(ruleset,new JsonPersistence(join(dir,"state.json")));}
const settings={roomName:"测试房间",allowGuests:true,allowSpectators:true,turnTimeSeconds:30,responseTimeSeconds:20,reserveTimeSeconds:60,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
describe("application projections",()=>{
 it("validates lobby, waiting room and private character selection snapshots",async()=>{const rooms=await service(),users=[1,2,3,4].map(n=>({userId:`u${n}`,displayName:`玩家${n}`}));expect(validateProtocol("room",lobbyProjection(users[0]!,rooms.rooms.values())).ok).toBe(true);const created=await rooms.handle(users[0]!,{commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});for(const user of users)expect(validateProtocol("room",roomProjection(room,user,ruleset))).toEqual({ok:true});for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`ready${i}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"ready0",roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"start",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});for(const user of users)expect(validateProtocol("room",roomProjection(room,user,ruleset))).toEqual({ok:true});
 });
 it("validates setup and running game snapshots without leaking hands",async()=>{const rooms=await service(),users=[1,2,3,4].map(n=>({userId:`g${n}`,displayName:`玩家${n}`})),created=await rooms.handle(users[0]!,{commandId:"c",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`j${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});for(const user of users)await rooms.handle(user,{commandId:`r${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"s",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`l${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}const projector=new GameProjector(ruleset);for(const user of users)expect(validateProtocol("game",projector.game(room,user.userId))).toEqual({ok:true});for(const seat of [1,2,3,4] as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;for(const user of users)expect(validateProtocol("game",projector.game(room,user.userId))).toEqual({ok:true});
 });
 it("talent equip offers carry a human-readable slot label so the client can distinguish the 3 slot options",async()=>{
  const rooms=await service(),users=[1,2,3,4].map(n=>({userId:`e${n}`,displayName:`玩家${n}`}));
  const created=await rooms.handle(users[0]!,{commandId:"c",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;
  for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`j${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});
  for(const user of users)await rooms.handle(user,{commandId:`r${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});
  await rooms.handle(users[0]!,{commandId:"s",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});
  for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`l${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}
  for(const seat of [1,2,3,4] as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;
  // 手动推进到 1 号玩家的出牌阶段：清空抢注状态与窗口，将 3 张天赋牌塞入手牌，挂起 play 窗口。
  const state=room.game!;state.activeSeat=1;state.phase="play";state.phaseBoundary="body";state.combat.attack=null;state.pendingWindows=[];
  const hand=state.zones["hand:1"]!.orderedCardRefs;hand.length=0;
  const talentRefs=Object.values(state.cards).filter(c=>c.templateId.startsWith("talent.")).slice(0,3).map(c=>c.cardRef);
  hand.push(...talentRefs);
  state.pendingWindows=[{promptId:"prompt:play:1",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:Date.now()+1000,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}}];
  const projector=new GameProjector(ruleset),snap=projector.game(room,users[0]!.userId) as any;
  const talent=snap.interaction.offers.filter((o:any)=>o.offerId.includes("talent-equip"));
  expect(talent.length,`预期生成天赋槽位报价，实际 ${talent.length}`).toBeGreaterThan(0);
  const slots=[...new Set(talent.map((o:any)=>(o.preview as any)?.slot))];
  expect(slots.every((slot)=>typeof slot==="string"&&slot.startsWith("talent:"))).toBe(true);
 });
 it("preselectableWeaponSlots includes armor and talent slots when equip offers exist (client can click them)",async()=>{
  const rooms=await service(),users=[1,2,3,4].map(n=>({userId:`f${n}`,displayName:`玩家${n}`}));
  const created=await rooms.handle(users[0]!,{commandId:"c",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;
  for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`j${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});
  for(const user of users)await rooms.handle(user,{commandId:`r${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});
  await rooms.handle(users[0]!,{commandId:"s",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});
  for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`l${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}
  for(const seat of [1,2,3,4] as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;
  const state=room.game!;state.activeSeat=1;state.phase="play";state.phaseBoundary="body";state.combat.attack=null;state.pendingWindows=[];
  const hand=state.zones["hand:1"]!.orderedCardRefs;hand.length=0;
  const talentRefs=Object.values(state.cards).filter(c=>c.templateId.startsWith("talent.")).slice(0,3).map(c=>c.cardRef);
  const armorRefs=Object.values(state.cards).filter(c=>c.templateId.startsWith("armor.")).slice(0,1).map(c=>c.cardRef);
  hand.push(...talentRefs,...armorRefs);
  state.pendingWindows=[{promptId:"prompt:play:1",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:Date.now()+1000,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}}];
  const projector=new GameProjector(ruleset),snap=projector.game(room,users[0]!.userId) as any;
  const offers=snap.interaction.offers;
  expect(offers.some((o:any)=>o.offerId.includes("talent-equip")),`预期有天赋装备报价`).toBe(true);
  expect(offers.some((o:any)=>o.offerId.includes("armor-equip")),`预期有防具装备报价`).toBe(true);
  const preselectable:any[]=snap.privateView.preselectableWeaponSlots;
  expect(preselectable).toContain("armor");
  expect(preselectable).toContain("talent:0:1");
  expect(preselectable).toContain("talent:1:1");
  expect(preselectable).toContain("talent:2:1");
 });
 it("activeWindow surfaces the triggering ability for think windows (神圣屏障/逆天改命) so the banner shows 使用+技能名",async()=>{
  const rooms=await service(),users=[1,2,3,4].map(n=>({userId:`k${n}`,displayName:`玩家${n}`}));
  const created=await rooms.handle(users[0]!,{commandId:"c",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;
  for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`j${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});
  for(const user of users)await rooms.handle(user,{commandId:`r${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});
  await rooms.handle(users[0]!,{commandId:"s",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});
  for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`l${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}
  for(const seat of [1,2,3,4] as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;
  const state=room.game!;state.activeSeat=1;state.phase="play";state.phaseBoundary="body";state.combat.attack=null;
  const projector=new GameProjector(ruleset);
  state.pendingWindows=[{promptId:"p:db",kind:"divineBarrierDamage",prioritySeat:3,mandatory:false,deadlineAt:Date.now()+1000,timeoutPolicy:"pass",legalOfferIds:[],context:{}}];
  let snap=projector.game(room,users[0]!.userId) as any;
  expect((snap as any).activeWindow.abilityId,"神圣屏障窗口应携带技能 id，横幅显示 使用神圣屏障").toBe("skill.paladin.divine_barrier");
  state.pendingWindows=[{promptId:"p:pj",kind:"preJudgment",prioritySeat:3,mandatory:false,deadlineAt:Date.now()+1000,timeoutPolicy:"pass",legalOfferIds:[],context:{shamanSeat:3}}];
  snap=projector.game(room,users[0]!.userId) as any;
  expect((snap as any).activeWindow.abilityId,"逆天改命窗口应携带技能 id，横幅显示 使用逆天改命").toBe("skill.shaman.defy_fate");
  state.pendingWindows=[{promptId:"p:sp",kind:"statuePaladinResponse",prioritySeat:3,mandatory:false,deadlineAt:Date.now()+1000,timeoutPolicy:"pass",legalOfferIds:[],context:{}}];
  snap=projector.game(room,users[0]!.userId) as any;
  expect((snap as any).activeWindow.abilityId,"圣骑士雕像思考窗口应携带技能 id，横幅显示 使用思考").toBe("skill.statue.paladin_think");
 });
 it("game projection cards carry no description (client resolves locally)",async()=>{const rooms=await service(),users=[1,2,3,4].map(n=>({userId:`d${n}`,displayName:`玩家${n}`})),created=await rooms.handle(users[0]!,{commandId:"c",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`j${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});for(const user of users)await rooms.handle(user,{commandId:`r${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"s",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`l${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}const projector=new GameProjector(ruleset);for(const seat of [1,2,3,4] as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;const snap=projector.game(room,users[0]!.userId);if(snap.type!=="GAME_SNAPSHOT")throw new Error("expected running game");const cards=[...(snap.publicView.players.flatMap(p=>[...p.equipmentSlots.talents,...p.judgmentZone??[]])),...(snap.privateView.hand??[])].filter(Boolean);const views=[...cards,...snap.publicView.discardTop,...snap.publicView.centralCards];for(const view of views){expect(view.summary,`卡片 ${view.ref} 不应携带服务端描述`).toBe("");expect(view.coreStats,"卡片详情应由客户端本地化文件解析").toEqual([]);}
 });
});
