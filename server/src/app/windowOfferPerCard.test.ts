import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameProjector} from "./projection.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"逐牌窗口",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function state():AuthoritativeGameState{let s=createInitialSetup(ruleset,{gameId:"per-card",firstSeat:1,seed:711,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.wizard",2:"character.knight",3:"character.ranger",4:"character.alchemist"}});for(const seat of[1,2,3,4]as Seat[])s=resolveInitialRedraw(s,seat,false,ruleset).state;return s;}
function takeCard(s:AuthoritativeGameState,toZoneRef:string):string{const entry=Object.entries(s.cards).find(([,c])=>c.zoneRef==="drawPile")!;const ref=entry[0],card=entry[1],from=s.zones[card.zoneRef]!;from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);s.zones[toZoneRef]!.orderedCardRefs.push(ref);card.zoneRef=toZoneRef;card.ownerSeat=toZoneRef.startsWith("hand:")?Number(toZoneRef.split(":")[1]) as Seat:null;card.controllerSeat=card.ownerSeat;card.faceUp=!toZoneRef.startsWith("hand:");return ref;}
function makeRoom(s:AuthoritativeGameState):AppRoom{return{roomId:s.gameId,roomCode:"PER",revision:1,phase:"inGame",settings,passwordHash:null,players:s.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:s,createdAt:0,updatedAt:0};}
function offersOf(room:AppRoom,userId:string){const snap=new GameProjector(ruleset).game(room,userId) as any;return snap.interaction.offers as Array<{offerId:string;kind:string;sourceRefs:string[]}>;}

describe("逐牌选择窗口：每个按钮对应一张牌（公开具名/手牌手牌N）",()=>{
 it("triggerCardSelection：每个 offer 的 sourceRefs 恰为对应的一张牌（装备区具名、手牌手牌N）",()=>{
  const s=state(),publicRef=takeCard(s,"weapon:1:2"),hiddenRef=takeCard(s,"hand:2");
  s.pendingWindows=[{promptId:"prompt:trigger:1",kind:"triggerCardSelection",prioritySeat:1,mandatory:false,deadlineAt:1000,timeoutPolicy:"pass",legalOfferIds:["offer:trigger-card:0","offer:trigger-card:1","offer:trigger-card:pass"],context:{legalCardRefs:[publicRef,hiddenRef]}}];
  const room=makeRoom(s),offers=offersOf(room,"u1").filter(o=>o.offerId.startsWith("offer:trigger-card:")&&!o.offerId.endsWith(":pass"));
  expect(offers.length).toBe(2);
  // 当前实现会把全部合法牌塞进每个 offer 的 sourceRefs，无法分辨按钮对应哪张牌
  expect(offers[0]!.sourceRefs,"0 号按钮应只对应第一张牌").toHaveLength(1);
  expect(offers[1]!.sourceRefs,"1 号按钮应只对应第二张牌").toHaveLength(1);
  expect(offers[0]!.sourceRefs[0]!.startsWith("concealed:")||offers[0]!.sourceRefs[0]!.startsWith("public:")||offers[0]!.sourceRefs[0]!.startsWith("private:")).toBe(true);
 });
 it("statuePriestTake：展示牌也能投影为逐牌 sourceRefs（remainingCardRefs）",()=>{
  const s=state(),show=takeCard(s,"resolving");
  s.cards[show]!.faceUp=true;
  s.pendingWindows=[{promptId:"prompt:priest:1",kind:"statuePriestTake",prioritySeat:1,mandatory:false,deadlineAt:1000,timeoutPolicy:"pass",legalOfferIds:["offer:statue-priest:pass","offer:statue-priest:0"],context:{statueRef:"card:statue-priest",remainingSeats:[1],remainingCardRefs:[show]}}];
  const room=makeRoom(s),offers=offersOf(room,"u1").filter(o=>o.offerId.startsWith("offer:statue-priest:")&&!o.offerId.endsWith(":pass"));
  expect(offers.length,"牧师雕像拿牌按钮").toBe(1);
  expect(offers[0]!.sourceRefs,"牧师雕像按钮应能投影出对应展示牌").toHaveLength(1);
  expect(offers[0]!.sourceRefs[0]).toBe(`public:${show}`);
 });
 it("statueCardSelection（精灵拆牌）：手牌按钮为 concealed 引用，公开牌按钮为具名引用",()=>{
  const s=state(),publicRef=takeCard(s,"weapon:1:2"),hiddenRef=takeCard(s,"hand:2");
  s.pendingWindows=[{promptId:"prompt:elf:1",kind:"statueCardSelection",prioritySeat:1,mandatory:true,deadlineAt:1000,timeoutPolicy:"randomLegal",legalOfferIds:["offer:statue-card:0","offer:statue-card:1"],context:{statueRef:"card:statue-elf",statueFamily:"statue.elf",targetRef:"character:2",legalCardRefs:[publicRef,hiddenRef],publicCardRefs:[publicRef],hiddenCardCount:1}}];
  const room=makeRoom(s),offers=offersOf(room,"u1").filter(o=>o.offerId.startsWith("offer:statue-card:"));
  expect(offers[0]!.sourceRefs).toEqual([`public:${publicRef}`]);
  expect(offers[1]!.sourceRefs[0]!.startsWith("concealed:")).toBe(true);
 });
});
