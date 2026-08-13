import {mkdtemp,rm} from "node:fs/promises";
import type {AddressInfo} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import WebSocket from "ws";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {Seat} from "../engine/state.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {SkbApplicationServer} from "./server.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import {createTestApi,injectHand,summarize} from "./testApi.js";

// Agent 测试环境：setup/hand/deck/state 接口与直达正文的权威状态构造。
let ruleset:LoadedRuleset;const dirs:string[]=[];const servers:SkbApplicationServer[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));await Promise.all(servers.splice(0).map(server=>server.close()));delete process.env.SKB_TEST_MODE;});

async function makeServer(){const dir=await mkdtemp(join(tmpdir(),"skb-tapi-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const testApi=createTestApi({rooms,ruleset,broadcast:()=>{}});const server=new SkbApplicationServer(rooms,ruleset,{}, {testApi});servers.push(server);await server.listen(0);return{rooms,port:(server.http.address() as AddressInfo).port};}
async function post(base:string,path:string,body:unknown){const response=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return{status:response.status,data:await response.json() as any};}

describe("testApi 单元（真实 HTTP，options.testApi）",()=>{
 it("setup(skipRedraw) 直达 inProgress，投影过协议，且已推进到真实窗口",async()=>{
  const {rooms,port}=await makeServer();const base=`http://127.0.0.1:${port}`;
  const {status,data}=await post(base,"/api/test/setup",{});
  expect(status).toBe(200);expect(data.ok).toBe(true);expect(data.players).toHaveLength(4);
  const room=rooms.rooms.get(data.roomId)!;expect(room.phase).toBe("inGame");expect(room.test).toBe(true);
  const game=room.game!;expect(game.lifecycle).toBe("inProgress");expect(game.round).toBe(1);expect(game.activeSeat).toBe(data.firstSeat);
  for(const seat of [1,2,3,4]as Seat[])expect(game.zones[`hand:${seat}`]!.orderedCardRefs.length).toBeGreaterThanOrEqual(4);
  const snap=new GameProjector(ruleset).game(room,data.players[0].userId) as any;
  expect(snap.type).toBe("GAME_SNAPSHOT");expect(validateProtocol("game",snap)).toEqual({ok:true});
  expect(game.pendingWindows.length).toBeGreaterThan(0);
 });
 it("指定角色与 firstSeat 生效",async()=>{
  const {rooms,port}=await makeServer();const base=`http://127.0.0.1:${port}`;
  const {status,data}=await post(base,"/api/test/setup",{firstSeat:3,charactersBySeat:{1:"character.shaman",2:"character.berserker",3:"character.elf",4:"character.wizard"}});
  expect(status).toBe(200);const game=rooms.rooms.get(data.roomId)!.game!;
  expect(game.setup!.firstSeat).toBe(3);expect(game.activeSeat).toBe(3);
  expect(game.players.find(p=>p.seat===1)!.characterId).toBe("character.shaman");
  expect(data.players[0]!.characterId).toBe("character.shaman");
 });
 it("hands 注入后手牌匹配且 validate 通过；模板不足报错且不落库",async()=>{
  const {rooms,port}=await makeServer();const base=`http://127.0.0.1:${port}`;
  const {data}=await post(base,"/api/test/setup",{hands:{1:["basic.kill.red","basic.kill.red","basic.potion.white","basic.dodge.white"]}});
  const game=rooms.rooms.get(data.roomId)!.game!;
  expect(game.zones["hand:1"]!.orderedCardRefs.map(ref=>game.cards[ref]!.templateId)).toEqual(["basic.kill.red","basic.kill.red","basic.potion.white","basic.dodge.white"]);
  const after=summarize(rooms.rooms.get(data.roomId)!);expect(after.players[0]!.handTemplates[0]).toBe("basic.kill.red");
  const {status,data:bad}=await post(base,"/api/test/setup",{hands:{1:["basic.horn.white","basic.horn.white"]}});
  expect(status).toBe(400);expect(bad.error).toContain("TEST_CARD_NOT_AVAILABLE");
 });
 it("deck top 注入后牌堆顶模板匹配（第一个在顶）",async()=>{
  const {rooms,port}=await makeServer();const base=`http://127.0.0.1:${port}`;
  const {data}=await post(base,"/api/test/setup",{});
  const {status,data:summary}=await post(base,"/api/test/deck",{gameId:data.gameId,templates:["basic.kill.red","basic.dodge.white"],mode:"top"});
  expect(status).toBe(200);expect(summary.drawPileTopTemplates[0]).toBe("basic.kill.red");expect(summary.drawPileTopTemplates[1]).toBe("basic.dodge.white");
 });
 it("hand 动态注入（append/replace）更新权威状态",async()=>{
  const {rooms,port}=await makeServer();const base=`http://127.0.0.1:${port}`;
  const {data}=await post(base,"/api/test/setup",{});
  const {data:appended}=await post(base,"/api/test/hand",{gameId:data.gameId,seat:2,templates:["basic.potion.red"],mode:"append"});
  const seat2=appended.players.find((p:any)=>p.seat===2)!;expect(seat2.handTemplates).toHaveLength(5);expect(seat2.handTemplates).toContain("basic.potion.red");
  const {data:replaced}=await post(base,"/api/test/hand",{gameId:data.gameId,seat:2,templates:["basic.dodge.blue"],mode:"replace"});
  const seat2b=replaced.players.find((p:any)=>p.seat===2)!;expect(seat2b.handTemplates).toHaveLength(1);expect(seat2b.handTemplates[0]).toBe("basic.dodge.blue");
 });
 it("state 返回权威摘要",async()=>{
  const {rooms,port}=await makeServer();const base=`http://127.0.0.1:${port}`;
  const {data}=await post(base,"/api/test/setup",{});
  const response=await fetch(`${base}/api/test/state?gameId=${data.gameId}`);const summary=await response.json() as any;
  expect(response.status).toBe(200);expect(summary.gameId).toBe(data.gameId);expect(summary.players).toHaveLength(4);expect(summary.players[0].handTemplates.length).toBeGreaterThanOrEqual(4);expect(Array.isArray(summary.pendingWindows)).toBe(true);
 });
 it("injectHand 纯函数：直接改引擎状态后 validate 通过",()=>{
  const users={1:"u1",2:"u2",3:"u3",4:"u4"};const chars={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"};
  let s=createInitialSetup(ruleset,{gameId:"raw",firstSeat:1,seed:7,usersBySeat:users,characterIdsBySeat:chars});
  for(const seat of[1,2,3,4]as Seat[])s=resolveInitialRedraw(s,seat,false,ruleset).state;
  injectHand(s,3,["basic.kill.green","basic.kill.green","basic.horn.white","basic.coin.white"],"replace");
  expect(s.zones["hand:3"]!.orderedCardRefs.map(ref=>s.cards[ref]!.templateId)).toEqual(["basic.kill.green","basic.kill.green","basic.horn.white","basic.coin.white"]);
 });
});

type WireEntry={type:"MESSAGE"|"COMMAND_RESULT"|"PONG";channel?:"room"|"game";message?:any;seq:number};
class TestClient{readonly messages:WireEntry[]=[];private seq=0;readonly open:Promise<void>;constructor(private readonly socket:WebSocket){this.open=new Promise((resolve,reject)=>{socket.once("open",()=>resolve());socket.once("error",reject);});socket.on("message",raw=>this.accept(String(raw)));}send(message:unknown){this.socket.send(JSON.stringify(message));}close(){if(this.socket.readyState===this.socket.OPEN)this.socket.close();else this.socket.terminate();}private accept(raw:string){const wire=JSON.parse(raw) as WireEntry;wire.seq=++this.seq;if(wire.type==="MESSAGE"||wire.type==="COMMAND_RESULT"){const result=validateProtocol(wire.channel!,wire.message);if(!result.ok)throw new Error(`E2E protocol invalid: ${result.errors.join("; ")}`);}this.messages.push(wire);}}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const starts=(clients:TestClient[])=>clients.map(client=>({client,index:client.messages.length}));
async function waitFor(clients:TestClient[],start:{client:TestClient;index:number}[],predicate:(entry:WireEntry)=>boolean,timeout=8000){const deadline=Date.now()+timeout;while(Date.now()<deadline){for(const item of start){const entry=item.client.messages.slice(item.index).find(predicate);if(entry)return entry;}await delay(20);}throw new Error("E2E wait timeout");}
async function command(client:TestClient,message:any,channel:"room"|"game"){const start=starts([client]);client.send({type:"COMMAND",channel,command:message});const entry=await waitFor([client],start,item=>item.type==="COMMAND_RESULT"&&item.channel===channel&&item.message.commandId===message.commandId);if(!String(entry.message.type).endsWith("ACCEPTED"))throw new Error(`E2E command rejected: ${entry.message.reasonCode}`);return entry.message;}

describe("testApi E2E（SKB_TEST_MODE=1，真实 WS，真广播）",()=>{
 it("setup 后 4 WS 连接收 GAME_SNAPSHOT 并可执行命令",async()=>{
  process.env.SKB_TEST_MODE="1";
  const dir=await mkdtemp(join(tmpdir(),"skb-tapi-e2e-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();
  const server=new SkbApplicationServer(rooms,ruleset,{}, {serveStatic:false});servers.push(server);await server.listen(0);
  const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const setup=await post(base,"/api/test/setup",{hands:{1:["basic.kill.red","basic.kill.red","basic.potion.white","basic.dodge.white"]}});
  expect(setup.status).toBe(200);
  const clients=setup.data.players.map((player:any)=>new TestClient(new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(player.token)}`)));
  await Promise.all(clients.map((client: TestClient) => client.open));
  try{
   const snaps=await Promise.all(setup.data.players.map((player:any,index:number)=>waitFor([clients[index]!],[{client:clients[index]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===player.seat)));
   for(const [index,player] of setup.data.players.entries()){
    const snap=snaps[index]!.message;expect(snap.type).toBe("GAME_SNAPSHOT");expect(snap.viewer.seat).toBe(player.seat);
    if(player.seat===1)expect(snap.privateView.hand.map((card:any)=>card.templateId)).toEqual(["basic.kill.red","basic.kill.red","basic.potion.white","basic.dodge.white"]);
   }
   const seat1Snap=snaps[0]!.message;
   const accepted=await command(clients[0]!,{type:"GAME_COMMAND",commandId:"testpre",gameId:seat1Snap.gameId,expectedStateRevision:seat1Snap.stateRevision,command:"SET_PRESELECTION",payload:{weaponSlot:"weapon:1:1",modeId:null}},"game");
   expect(accepted.type).toBe("COMMAND_ACCEPTED");
   // 动态注入后客户端收到新快照（真广播）
   const before=clients[0]!.messages.length;
   await post(base,"/api/test/hand",{gameId:seat1Snap.gameId,seat:1,templates:["basic.potion.green"],mode:"append"});
   const updated=await waitFor([clients[0]!],[{client:clients[0]!,index:before}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===1&&entry.message.privateView.hand.some((card:any)=>card.templateId==="basic.potion.green"));
   expect(updated.message.privateView.hand).toHaveLength(5);
  }finally{for(const client of clients)client.close();}
 });
});
