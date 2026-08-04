// 房间生命周期：1 人离开房间不结束房间；全离开/全离线/对局结束才结束；
// 房主 DISBAND_ROOM 解散房间（对局中=原房间按钮效果）。
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function service(){const dir=await mkdtemp(join(tmpdir(),"skb-room-")),rooms=new RoomService(ruleset,new JsonPersistence(join(dir,"state.json")));dirs.push(dir);await rooms.restore();return rooms;}
const settings={roomName:"房间生命周期",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
const users=[1,2,3,4].map(n=>({userId:`rl${n}`,displayName:`玩家${n}`}));
async function openRoom(rooms:RoomService){const created=await rooms.handle(users[0]!,{commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}});const room=created.room!;for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});return room;}
async function startGame(rooms:RoomService){const room=await openRoom(rooms);for(let i=0;i<4;i++)await rooms.handle(users[i]!,{commandId:`ready${i}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"start",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`lock${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}return room;}

describe("room lifecycle",()=>{
 it("keeps the room open when one player leaves while others remain",async()=>{
  const rooms=await service(),room=await openRoom(rooms);
  const result=await rooms.handle(users[3]!,{commandId:"leave3",roomId:room.roomId,expectedRoomRevision:room.revision,command:"LEAVE_ROOM",payload:{}});
  expect(result.accepted.type).toBe("ROOM_COMMAND_ACCEPTED");
  expect(room.phase).toBe("waiting");
  expect(room.players).toHaveLength(3);
 });
 it("closes the room only when every player has left",async()=>{
  const rooms=await service(),room=await openRoom(rooms);
  for(let i=0;i<4;i++)await rooms.handle(users[i]!,{commandId:`leave${i}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LEAVE_ROOM",payload:{}});
  expect(room.phase).toBe("closed");
  expect(room.players).toHaveLength(0);
 });
 it("lets the host disband the room mid-game, clearing players like the old close button",async()=>{
  const rooms=await service(),room=await startGame(rooms);
  expect(room.phase).toBe("inGame");
  const result=await rooms.handle(users[0]!,{commandId:"disband",roomId:room.roomId,expectedRoomRevision:room.revision,command:"DISBAND_ROOM",payload:{}});
  expect(result.accepted.type).toBe("ROOM_COMMAND_ACCEPTED");
  expect(room.phase).toBe("closed");
  expect(room.players).toHaveLength(0);
  expect(room.spectators).toHaveLength(0);
  expect(room.game!.lifecycle).toBe("ended");
 });
 it("rejects DISBAND_ROOM from a non-host",async()=>{
  const rooms=await service(),room=await startGame(rooms);
  await expect(rooms.handle(users[1]!,{commandId:"disband-nh",roomId:room.roomId,expectedRoomRevision:room.revision,command:"DISBAND_ROOM",payload:{}})).rejects.toMatchObject({code:"HOST_PERMISSION_REQUIRED"});
  expect(room.phase).toBe("inGame");
 });
 it("ends the room when all players are offline for the idle window, even mid-game",async()=>{
  const rooms=await service(),room=await startGame(rooms);
  const now=Date.now();
  for(const p of room.players){p.connection="offline";p.disconnectDeadlineAt=null;}
  room.updatedAt=now-61*60*1000;
  expect(rooms.cleanupRooms(now)).toBe(true);
  expect(rooms.rooms.has(room.roomId)).toBe(false);
 });
});
