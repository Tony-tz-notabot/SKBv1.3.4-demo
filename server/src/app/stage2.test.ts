import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {resolveInitialRedraw} from "../engine/setup.js";
import {GameProjector} from "./projection.js";
import {GameService} from "./gameService.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {validateProtocol} from "./protocol.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const settings={roomName:"阶段二",allowGuests:true,allowSpectators:true,turnTimeSeconds:30,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
async function roomService(){const dir=await mkdtemp(join(tmpdir(),"skb-stage2-"));dirs.push(dir);return new RoomService(ruleset,new JsonPersistence(join(dir,"state.json")));}
async function startedRoom(rooms:RoomService){const users=[1,2,3,4].map(n=>({userId:`s${n}`,displayName:`玩家${n}`})),created=await rooms.handle(users[0]!,{commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});for(const user of users)await rooms.handle(user,{commandId:`ready${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"start",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`lock${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}return{rooms,room,users};}

describe("stage two application primitives",()=>{
 it("creates and resolves server-issued session tokens",async()=>{const rooms=await roomService(),session=rooms.createSession("测试用户");expect(session.token).toBeTruthy();expect(rooms.resolveSession(session.token)).toMatchObject({userId:session.userId,displayName:"测试用户"});expect(rooms.resolveSession("missing")).toBeNull();});
 it("persists room command idempotency across restore",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-stage2-idem-")),path=join(dir,"state.json"),rooms=new RoomService(ruleset,new JsonPersistence(path)),user={userId:"idem",displayName:"幂等"},result=await rooms.handle(user,{commandId:"same",command:"CREATE_ROOM",payload:{settings,password:null}});await rooms.persist();dirs.push(dir);const restored=new RoomService(ruleset,new JsonPersistence(path));await restored.restore();const repeated=await restored.handle(user,{commandId:"same",command:"CREATE_ROOM",payload:{settings,password:null}});expect(repeated.accepted).toEqual(result.accepted);expect(restored.rooms.size).toBe(1);});
 it("persists game command idempotency across GameService restore",async()=>{const {room,users}=await startedRoom(await roomService()),user=users[0]!,before=room.game!.stateRevision,service=new GameService(ruleset,()=>1),command={commandId:"preselect",gameId:room.game!.gameId,expectedStateRevision:before,command:"SET_PRESELECTION" as const,payload:{weaponSlot:null,modeId:null}},first=service.handle(room,user,command);expect(first.accepted).toBe(true);const persisted=service.persistedResults(),secondService=new GameService(ruleset,()=>1);secondService.restore(persisted);const stateAfter=room.game!.stateRevision,repeated=secondService.handle(room,user,command);expect(repeated).toEqual(first);expect(room.game!.stateRevision).toBe(stateAfter);});
});

describe("stage two projections",()=>{
 it("projects a spectator game snapshot without private hand or interaction data",async()=>{const {rooms,room,users}=await startedRoom(await roomService()),spectator={userId:"spectator",displayName:"观战"},projector=new GameProjector(ruleset);for(const seat of[1,2,3,4]as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;await rooms.handle(spectator,{commandId:"spectate",command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:true}});const snapshot=projector.spectator(room,spectator.userId) as any;expect(validateProtocol("game",snapshot)).toEqual({ok:true});expect(snapshot.viewer).toEqual({userId:spectator.userId,seat:null,team:null});expect(snapshot.privateView.hand).toHaveLength(0);expect(snapshot.interaction.offers).toHaveLength(0);for(const player of users){const privateSnapshot=projector.game(room,player.userId) as any;expect(privateSnapshot.privateView.hand.length).toBeGreaterThanOrEqual(0);}
 });
 it("maps presentation events through Ajv and filters hidden refs by audience",async()=>{const {room,users}=await startedRoom(await roomService());for(const seat of[1,2,3,4]as const)room.game=resolveInitialRedraw(room.game!,seat,true,ruleset).state;const events=room.game!.history.domainEvents,projector=new GameProjector(ruleset),forOwner=projector.presentationFor(room.game!,"s1",events),forOther=projector.presentationFor(room.game!,"s2",events);expect(forOwner.length).toBeGreaterThan(0);for(const event of forOwner)expect(validateProtocol("game",event)).toEqual({ok:true});for(const event of forOther)expect(validateProtocol("game",event)).toEqual({ok:true});expect(JSON.stringify(forOther)).not.toContain("private:s1:");expect(JSON.stringify(forOwner)).not.toContain("private:s2:");});
});
