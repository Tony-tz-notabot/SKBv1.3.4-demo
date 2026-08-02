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
});
