import {mkdir,readFile,readdir,rename,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import type {GameLogMeta,LogEntry,MatchLogFile,MatchLogSink} from "./matchLog.js";
import {projectLogView} from "./matchLog.js";

// 对局日志文件持久化：每局结束写 server/data/logs/<gameId>.json（原子写+队列串行化，
// 仿 JsonPersistence）。赛后查看 API（list/read）按用户参与过滤、按观众座位脱敏。

export interface MatchLogMetaView {
  gameId:string; roomId:string; roomCode:string; rulesetVersion:string;
  startedAt:number; endedAt:number; winnerTeam:"A"|"B"|null; firstSeat:number;
  players:GameLogMeta["players"];
}

export class MatchLogStore implements MatchLogSink {
  readonly dir:string;
  #queue:Promise<void>=Promise.resolve();
  constructor(dir=resolve(process.cwd(),"data","logs")){this.dir=resolve(dir)}
  async save(gameId:string,payload:MatchLogFile):Promise<void>{
   const write=this.#queue.then(async()=>{
    await mkdir(this.dir,{recursive:true});
    const file=resolve(this.dir,`${gameId}.json`),temporary=`${file}.tmp`;
    await writeFile(temporary,JSON.stringify(payload),"utf8");
    try{await rename(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
   });
   this.#queue=write.catch(()=>{});
   return write;
  }
  private async loadFile(gameId:string):Promise<MatchLogFile|null>{
   try{return JSON.parse(await readFile(resolve(this.dir,`${gameId}.json`),"utf8")) as MatchLogFile;}catch{return null;}
  }
  async list(userId:string):Promise<MatchLogMetaView[]>{
   let names:string[];
   try{names=await readdir(this.dir);}catch{return[];}
   const out:MatchLogMetaView[]=[];
   for(const name of names.filter(n=>n.endsWith(".json"))){
    const file=await this.loadFile(name.slice(0,-5));if(!file)continue;
    if(!file.players.some(p=>p.userId===userId))continue;
    out.push({gameId:file.gameId,roomId:file.roomId,roomCode:file.roomCode,rulesetVersion:file.rulesetVersion,startedAt:file.startedAt,endedAt:file.endedAt,winnerTeam:file.winnerTeam,firstSeat:file.firstSeat,players:file.players});
   }
   return out.sort((a,b)=>b.endedAt-a.endedAt);
  }
  async read(gameId:string,userId:string|null):Promise<{meta:MatchLogMetaView;entries:LogEntry[]}|null>{
   const file=await this.loadFile(gameId);if(!file)return null;
   const viewerSeat=file.players.find(p=>p.userId===userId)?.seat??null;
   const entries=projectLogView([...file.summary,...file.atomic].sort((a,b)=>a.seq-b.seq),viewerSeat,1_000_000);
   return{meta:{gameId:file.gameId,roomId:file.roomId,roomCode:file.roomCode,rulesetVersion:file.rulesetVersion,startedAt:file.startedAt,endedAt:file.endedAt,winnerTeam:file.winnerTeam,firstSeat:file.firstSeat,players:file.players},entries};
  }
}
