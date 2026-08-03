import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,PendingWindowState,Seat} from "../engine/state.js";
import {GameService} from "./gameService.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"超时",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function engineState(seed=331,seat1="character.wizard"):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`timeout-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:seat1,2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"TO",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}

describe("window timeout coverage",()=>{
 it("provides a timeout path for the previously uncovered registry windows",async()=>{
  const source=await readFile(resolve(import.meta.dirname,"../../../server/src/app/windowRegistry.ts"),"utf8");
  expect(source).toContain("handleTimeout");expect(source).toContain("timeoutPolicy===\"randomLegal\"");
  for(const kind of["engineerMechChoice","qiBallDismantle","temporaryCoinImmediateUse","trapBombDetonation","wizardSpellStrike"]){
   expect(source,kind).toMatch(new RegExp(`${kind}:standard\\(`));
  }
 });
 it("times out a pass-policy wizard spell strike window by passing",()=>{
  let state=engineState(332,"character.wizard");state.pendingWindows=[{promptId:"prompt:wss:1",kind:"wizardSpellStrike",prioritySeat:1,mandatory:false,deadlineAt:1,timeoutPolicy:"pass",legalOfferIds:["offer:wizard-spell-strike:pass","offer:wizard-spell-strike:activate"],context:{attackId:"a:1",targetRef:"character:2",legalCardRefs:[]}}];
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  expect(room.game!.pendingWindows[0]!.kind).toBe("wizardSpellStrike");
  const result=service.timeout(room);
  expect(result).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="wizardSpellStrike")).toBe(false);
 });
 it("times out a random-legal engineer mech choice through the authoritative random source",()=>{
  let state=engineState(333,"character.engineer");state.players.find(p=>p.seat===1)!.markers["engineer.mechActive"]=true;state.players.find(p=>p.seat===1)!.markers["engineer.mechKind"]="prototype";
  state.pendingWindows=[{promptId:"prompt:mech:1",kind:"engineerMechChoice",prioritySeat:1,mandatory:true,deadlineAt:1,timeoutPolicy:"randomLegal",legalOfferIds:["offer:engineer-mech:prototype","offer:engineer-mech:vitaminC"],context:{}}];
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000),before=room.game!.randomHistory.length;
  const result=service.timeout(room);
  expect(result).toBe(true);expect(room.game!.pendingWindows.some(w=>w.kind==="engineerMechChoice")).toBe(false);
  expect(room.game!.randomHistory.length).toBeGreaterThan(before);
 });
 it("times out qi ball dismantle, temporary coin and bomb detonation windows without throwing",()=>{
  const cases:Array<[string,string,string[],boolean]>=[
   ["qiBallDismantle","prompt:qbd:1",["offer:qi-ball-dismantle"],true],
   ["temporaryCoinImmediateUse","prompt:tc:1",["offer:temporary-coin:use","offer:temporary-coin:pass"],false],
   ["trapBombDetonation","prompt:bd:1",["offer:bomb-detonate:pass","offer:bomb-detonate:now"],false],
  ];
  for(const [kind,promptId,offers,mandatory] of cases){
   let state=engineState(Number(`34${cases.indexOf([kind,promptId,offers,mandatory])}`),"character.trap_master");
   state.pendingWindows=[{promptId,kind,prioritySeat:1,mandatory,deadlineAt:1,timeoutPolicy:mandatory?"randomLegal":"pass",legalOfferIds:offers,context:{}}];
   const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
   expect(()=>service.timeout(room),kind).not.toThrow();
  }
 });
});
