import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import {buildTalentEquipOffers,TalentEquipSession} from "../engine/talentEquipment.js";
import {EngineTransaction} from "../engine/transaction.js";
import {ELECTRIC_MARK} from "../engine/electricMark.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {executeNextImmediateDamageEffect} from "../engine/directDamage.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

// 感电标记应用层验证：投影层数、directDamage 叠标记 op、装备电盾清除。
let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"感电",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function state(seed=801):AuthoritativeGameState{let s=createInitialSetup(ruleset,{gameId:`emapp-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])s=resolveInitialRedraw(s,seat,false,ruleset).state;s.players[0]!.hp=10;s.players[0]!.shield=10;s.activeSeat=1;s.phase="play";s.phaseBoundary="body";s.phaseBodyResolved=true;s.pendingWindows=[{promptId:"prompt:play",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:Date.now()+20000,timeoutPolicy:"pass",legalOfferIds:["offer:finish"],context:{}}];return s;}
function makeRoom(s:AuthoritativeGameState):AppRoom{return{roomId:s.gameId,roomCode:"EM",revision:1,phase:"inGame",settings,passwordHash:null,players:s.players.map(p=>({userId:p.userId,displayName:users[p.seat]!.displayName,seat:p.seat,team:p.team,isHost:p.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:s,createdAt:0,updatedAt:0};}
describe("感电标记应用层",()=>{
 it("投影输出玩家感电标记层数且通过 schema 校验",()=>{let s=state();s.players[0]!.markers[ELECTRIC_MARK]=2;const snap=new GameProjector(ruleset).game(makeRoom(s),"u1") as any;const viewer=snap.publicView.players.find((p:any)=>p.seat===1)!;expect(viewer.electricMark).toBe(2);expect(snap.publicView.players.find((p:any)=>p.seat===2)!.electricMark).toBe(0);expect(validateProtocol("game",snap)).toEqual({ok:true});});
 it("directDamage 的 addElectricMark op 叠层并清除",()=>{let s=state();s.pendingWindows=[];const tx=new EngineTransaction(s);tx.draft.scheduledEffects.push({scheduledId:"sched:em:1",sourceRef:"x",controllerSeat:1,executeAt:"immediate.damagePipeline",effect:{op:"addElectricMark",targetRef:"character:1",amount:1},cancelled:false});const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);const out=executeNextImmediateDamageEffect(committed.state,ruleset,Date.now()+20000);expect(Number(out.state.players[0]!.markers[ELECTRIC_MARK] ?? 0)).toBe(1);});
 it("装备电盾天赋清除已有感电标记",()=>{let s=state();const talent=Object.values(s.cards).find(c=>c.templateId==="talent.electric_shield")!.cardRef;const from=s.zones[s.cards[talent]!.zoneRef]!,i=from.orderedCardRefs.indexOf(talent);from.orderedCardRefs.splice(i,1);s.zones["hand:1"]!.orderedCardRefs.push(talent);Object.assign(s.cards[talent]!,{zoneRef:"hand:1",ownerSeat:1,controllerSeat:1,faceUp:false});s.players[0]!.markers[ELECTRIC_MARK]=2;const offer=buildTalentEquipOffers(s,1).find(o=>o.cardRef===talent)!;const session=new TalentEquipSession(s,ruleset);const out=session.handle({commandId:"equip-es",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:users[1]!.userId,promptId:"prompt:play",offerId:offer.offerId,cardRef:talent});expect(out.accepted).toBe(true);expect(Number(session.state.players[0]!.markers[ELECTRIC_MARK] ?? 0)).toBe(0);});
});
