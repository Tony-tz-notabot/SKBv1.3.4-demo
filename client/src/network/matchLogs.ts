import type {LogEntryView} from "@skb-protocol/client-protocol";
import {resolveApiBase} from "./serverAddress";

// 赛后查看对局记录：GET /api/match-logs（列表）与 /api/match-log/<gameId>（详情，服务端按用户座位脱敏）。

export interface MatchLogMetaView {
  gameId:string; roomId:string; roomCode:string; rulesetVersion:string;
  startedAt:number; endedAt:number; winnerTeam:"A"|"B"|null; firstSeat:number;
  players:Array<{seat:number; userId:string; displayName:string; characterId:string; team:"A"|"B"}>;
}
export interface MatchLogDetail {meta:MatchLogMetaView; entries:LogEntryView[]}

const apiBase=resolveApiBase(import.meta.env.VITE_WS_URL as string | undefined);

async function json<T>(url:string):Promise<T>{
 const res=await fetch(url);
 const data=await res.json() as {ok?:boolean; reason?:string} & T;
 if(!res.ok||data.ok===false)throw new Error(data.reason??"REQUEST_FAILED");
 return data;
}
export async function fetchMatchLogs(token:string):Promise<MatchLogMetaView[]>{
 const data=await json<{games:MatchLogMetaView[]}>(`${apiBase}/api/match-logs?token=${encodeURIComponent(token)}`);
 return data.games;
}
export async function fetchMatchLog(token:string,gameId:string):Promise<MatchLogDetail>{
 const data=await json<{meta:MatchLogMetaView; entries:LogEntryView[]}>(`${apiBase}/api/match-log/${encodeURIComponent(gameId)}?token=${encodeURIComponent(token)}`);
 return {meta:data.meta,entries:data.entries};
}
