import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {MatchLogStore} from "./matchLogStore.js";
import type {MatchLogFile} from "./matchLog.js";

// 文件持久化：原子写（无 .tmp 残留）、并发串行化、list/read 按用户过滤与按观众脱敏。

let dir:string;let store:MatchLogStore;
const players=[{seat:1,userId:"u1",displayName:"一",characterId:"character.knight",team:"A"},{seat:2,userId:"u2",displayName:"二",characterId:"character.ranger",team:"A"},{seat:3,userId:"u3",displayName:"三",characterId:"character.paladin",team:"B"},{seat:4,userId:"u4",displayName:"四",characterId:"character.wizard",team:"B"}] as const;
function file(gameId:string,winnerTeam:"A"|"B"|null=null):MatchLogFile{return{version:1,gameId,roomId:gameId,roomCode:"MLOG",rulesetVersion:"1.3.4",startedAt:1,endedAt:2,winnerTeam,forfeited:false,forfeitedBySeat:null,firstSeat:1,players:[...players],summary:[{seq:1,mode:"summary",type:"game.victory",tokens:[{t:"text",s:"A队"},{t:"sem",s:"胜利",cls:"sem-extra"}]}],atomic:[{seq:2,mode:"atomic",type:"card.drawn",tokens:[{t:"char",seat:1},{t:"text",s:"摸到"},{t:"card",templateId:"support.potion",color:"green",scope:"hand:1"}]}],events:[]};}
beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),"skb-matchlog-"));store=new MatchLogStore(dir);});
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});

describe("MatchLogStore 文件持久化",()=>{
 it("save 后文件存在且结构完整，无 .tmp 残留，目录自建",async()=>{
  await store.save("g1",file("g1","A"));
  const raw=JSON.parse(await readFile(join(dir,"g1.json"),"utf8")) as MatchLogFile;
  expect(raw.version).toBe(1);
  expect(raw.gameId).toBe("g1");
  expect(raw.winnerTeam).toBe("A");
  expect(raw.summary.length).toBe(1);
  expect(raw.atomic.length).toBe(1);
  expect(raw.players[0]!.userId).toBe("u1");
  expect(raw.players[0]!.displayName).toBe("一");
 });
 it("并发 save 串行化，最终为最后一次内容",async()=>{
  await Promise.all([store.save("g2",file("g2")),store.save("g2",file("g2","B"))]);
  const raw=JSON.parse(await readFile(join(dir,"g2.json"),"utf8")) as MatchLogFile;
  expect(raw.winnerTeam).toBe("B");
 });
 it("list 只返回该用户参与的对局，read 按观众座位脱敏（本人见牌名/他人折叠）",async()=>{
  const listU1=await store.list("u1");
  expect(listU1.map(g=>g.gameId)).toContain("g1");
  const listU5=await store.list("u5");
  expect(listU5).toHaveLength(0);
  const own=await store.read("g1","u1");
  const ownDraw=own!.entries.find(e=>e.type==="card.drawn")!;
  expect(ownDraw.tokens.some(t=>t.t==="card"&&t.templateId==="support.potion")).toBe(true);
  const other=await store.read("g1","u2");
  const otherDraw=other!.entries.find(e=>e.type==="card.drawn")!;
  expect(otherDraw.tokens.some(t=>t.t==="card")).toBe(false);
  expect(otherDraw.tokens.some(t=>t.t==="text"&&t.s==="1张牌")).toBe(true);
  const outsider=await store.read("g1","u5");
  const outsiderDraw=outsider!.entries.find(e=>e.type==="card.drawn")!;
  expect(outsiderDraw.tokens.some(t=>t.t==="card")).toBe(false);
  expect(await store.read("missing","u1")).toBeNull();
 });
});
