// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {beforeAll,describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import GameView from "../views/GameView.vue";

beforeAll(()=>{
  const css=readFileSync(join(process.cwd(),"src","styles","base.css"),"utf8");
  const style=document.createElement("style");
  style.textContent=css;
  document.head.appendChild(style);
});

const emptyPlayer={seat:1 as const,team:"A" as const,nickname:"玩家1",connected:true,characterId:"character.knight",lifeState:"inPlay" as const,hp:5,maxHp:5,shield:5,maxShield:5,ironShield:0,handCount:0,handLimit:4,equipment:[],equipmentSlots:{weapon1:null,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[],mountDual:false},judgmentZone:[],statuses:[]};
function snapshotWith(specs:any[],offerKind:string="resolveChoice",promptKind="test"){return{type:"GAME_SNAPSHOT" as const,gameId:"g",rulesetVersion:"1.3.4" as const,stateRevision:1,lastEventSeq:1,serverTime:Date.now(),viewer:{userId:"u1",seat:1 as const,team:"A" as const},publicView:{round:1,activeSeat:1 as const,phase:"play" as const,players:[emptyPlayer,{...emptyPlayer,seat:2 as const}],drawPileCount:10,discardTop:[],centralCards:[],headline:undefined,winnerTeam:null},privateView:{hand:[],preselectedWeaponSlot:null,preselectedModeId:null,preselectableWeaponSlots:[],concealedChoices:[]},interaction:{prompt:{promptId:"p:1",kind:promptKind,mandatory:false,deadlineAt:Date.now()+10000,prioritySeat:1 as const,timeoutPolicy:"pass" as const},offers:[{offerId:"offer:test:1",kind:offerKind,sourceRefs:[],legalTargetRefs:[],selectionSpecs:specs,preview:{costSummary:null}}],disabledHints:[]},chat:[]} as any;}
function mountView(snapshot:any){return mount(GameView,{props:{snapshot,events:[]},global:{stubs:{GamePlayerPanel:true,PromptBanner:true,ResourceImage:true}}});}

describe("GameView 页面布局（task6）",()=>{
 it("手牌区/操作区/日志+聊天都渲染，且 offer 按钮每列 3 行",async()=>{
  const wrapper=mountView(snapshotWith([]));
  // 手牌区存在且含 hand-cards
  const handZone=wrapper.find(".hand-zone");
  expect(handZone.exists()).toBe(true);
  expect(handZone.find(".hand-cards").exists()).toBe(true);
  // 操作区（含 offer 列表）存在
  const panel=wrapper.find(".interaction-panel");
  expect(panel.exists()).toBe(true);
  expect(panel.find(".offer-list .button").exists()).toBe(true);
  // 日志与聊天都存在（真实组件）
  expect(wrapper.find(".event-feed").exists()).toBe(true);
  expect(wrapper.find(".game-chat").exists()).toBe(true);
  // offer 按钮每列 3 行（纵向填充，超出自动换列）
  const offerList=panel.find(".offer-list").element as HTMLElement;
  expect(getComputedStyle(offerList).display, "offer-list 应使用 grid 布局").toBe("grid");
  expect(getComputedStyle(offerList).gridAutoFlow, "offer 按钮应按列纵向填充（每列 3 行）").toBe("column");
  expect(getComputedStyle(offerList).gridTemplateRows, "每列固定 3 行").toMatch(/repeat\(3|auto/);
 });
 it("操作区高度足以容纳每列 3 行按钮",async()=>{
  const wrapper=mountView(snapshotWith([]));
  const panel=wrapper.find(".interaction-panel").element as HTMLElement;
  const minHeight=parseFloat(getComputedStyle(panel).minHeight);
  expect(minHeight, "操作区 min-height 应足够容纳 3 行按钮，过矮会挤压/溢出").toBeGreaterThanOrEqual(300);
 });
 it("日志与聊天上下平分（纵向排列），且与主战斗区同排：左 3/4 战斗、右 1/4 活动区等高",async()=>{
  const wrapper=mountView(snapshotWith([]));
  const activity=wrapper.find(".game-activity");
  expect(activity.exists()).toBe(true);
  const cs=getComputedStyle(activity.element as HTMLElement);
  // 上下两栏：单列、两行
  expect(cs.gridTemplateColumns, "日志与聊天应上下排列（单列）").not.toMatch(/\s/);
  expect(cs.gridTemplateRows, "日志与聊天应上下平分（两行）").toMatch(/\s/);
  const feed=wrapper.find(".event-feed").element as HTMLElement;
  const chat=wrapper.find(".game-chat").element as HTMLElement;
  expect(feed.parentElement===activity.element, "事件流应直接位于 activity 容器内").toBe(true);
  expect(chat.parentElement===activity.element, "聊天应直接位于 activity 容器内").toBe(true);
  const css=readFileSync(join(process.cwd(),"src","styles","base.css"),"utf8");
  // 主战斗区宽度 3/4、活动区 1/4：布局列按 3fr/1fr
  expect(css, "游戏布局应为 3fr/1fr 双列（主战斗区 3/4、日志+聊天 1/4）").toMatch(/\.game-layout\s*\{[^}]*grid-template-columns:[^}]*3fr[^}]*1fr[^}]*\}/);
  // 主战斗区在左列、活动区在右列，且同一行（grid-row 相同 → 等高）
  const tableRule=/\.game-table\s*\{[^}]*grid-column:\s*1;?[^}]*grid-row:\s*3;?[^}]*\}/;
  const activityRule=/\.game-activity\s*\{[^}]*grid-column:\s*2;?[^}]*grid-row:\s*3;?[^}]*\}/;
  expect(tableRule.test(css),"game-table 应在左列第 3 行").toBe(true);
  expect(activityRule.test(css),"game-activity 应在右列第 3 行（与主战斗区同排等高）").toBe(true);
 });
});

describe("GameView 卡牌颜色虚线边框与牌名同色（task8）",()=>{
 it("手牌区卡牌带颜色虚线边框与同色牌名",async()=>{
  const snapshot=snapshotWith([]);
  snapshot.privateView.hand=[{ref:"private:u1:c1",templateId:"weapon.w01",displayName:"烈焰剑",category:"weapon",printedColor:"red",coreStats:[],summary:"",resourceKey:"card.weapon.w01",badges:[],state:{selected:false,effective:true},detailAvailable:true}];
  const wrapper=mountView(snapshot);
  const card=wrapper.find(".hand-zone .game-card");
  expect(card.exists()).toBe(true);
  expect(card.classes()).toContain("game-card--red");
  const name=card.find(".game-card__copy strong");
  expect(name.classes()).toContain("game-card__name--red");
 });
 it("弃牌区卡牌带颜色虚线边框与同色牌名",async()=>{
  const snapshot=snapshotWith([]);
  snapshot.publicView.discardTop=[{ref:"public:c1",templateId:"support.potion",displayName:"小血瓶",category:"support",printedColor:"green",coreStats:[],summary:"",resourceKey:"card.support.potion",badges:[],state:{selected:false,effective:true},detailAvailable:true}];
  const wrapper=mountView(snapshot);
  const card=wrapper.find(".discard-stack .game-card");
  expect(card.exists()).toBe(true);
  expect(card.classes()).toContain("game-card--green");
  const name=card.find(".game-card__copy strong");
  expect(name.classes()).toContain("game-card__name--green");
 });
});

describe("GameView 角色站位 4 角（task19）",()=>{
 const allSeats=()=>[1,2,3,4].map((seat)=>({...emptyPlayer,seat:seat as 1|2|3|4}));
 const cornerOf=(wrapper:ReturnType<typeof mountView>,seat:number)=>{
  const panel=wrapper.findAllComponents({name:"GamePlayerPanel"}).find((c)=>c.props("player").seat===seat);
  expect(panel,`seat ${seat} 应有角色面板`).toBeTruthy();
  return (panel!.element.parentElement as HTMLElement).getAttribute("data-position");
 };
 it("viewer 恒右下，其余按逆时针：右下→右上→左上→左下（座位递增）",()=>{
  // viewer 1：右下1 右上2 左上3 左下4
  const snap1=snapshotWith([]);
  snap1.publicView.players=allSeats();
  const w1=mountView(snap1);
  expect(cornerOf(w1,1),"viewer 必须始终在右下角").toBe("bottomRight");
  expect(cornerOf(w1,2)).toBe("topRight");
  expect(cornerOf(w1,3)).toBe("topLeft");
  expect(cornerOf(w1,4)).toBe("bottomLeft");
  // viewer 2：右下2 右上3 左上4 左下1（逆时针下家=座位+1）
  const snap2=snapshotWith([]);
  snap2.viewer={userId:"u2",seat:2 as const,team:"B" as const};
  snap2.publicView.players=allSeats();
  const w2=mountView(snap2);
  expect(cornerOf(w2,2),"viewer=2 必须在右下角（旧实现在左下）").toBe("bottomRight");
  expect(cornerOf(w2,3)).toBe("topRight");
  expect(cornerOf(w2,4)).toBe("topLeft");
  expect(cornerOf(w2,1)).toBe("bottomLeft");
  // viewer 3：右下3 右上4 左上1 左下2
  const snap3=snapshotWith([]);
  snap3.viewer={userId:"u3",seat:3 as const,team:"B" as const};
  snap3.publicView.players=allSeats();
  const w3=mountView(snap3);
  expect(cornerOf(w3,3),"viewer=3 必须在右下角").toBe("bottomRight");
  expect(cornerOf(w3,4)).toBe("topRight");
  expect(cornerOf(w3,1)).toBe("topLeft");
  expect(cornerOf(w3,2)).toBe("bottomLeft");
  // viewer 4：右下4 右上1 左上2 左下3
  const snap4=snapshotWith([]);
  snap4.viewer={userId:"u4",seat:4 as const,team:"A" as const};
  snap4.publicView.players=allSeats();
  const w4=mountView(snap4);
  expect(cornerOf(w4,4),"viewer=4 必须在右下角").toBe("bottomRight");
  expect(cornerOf(w4,1)).toBe("topRight");
  expect(cornerOf(w4,2)).toBe("topLeft");
  expect(cornerOf(w4,3)).toBe("bottomLeft");
 });
 it("4 角位置样式：每个角都落在角落（left/top 组合），而非四边中间",()=>{
  const snapshot=snapshotWith([]);
  snapshot.publicView.players=allSeats();
  const wrapper=mountView(snapshot);
  const rule=(pos:string)=>{const el=wrapper.find(`.game-player-position[data-position="${pos}"]`);expect(el.exists(),`缺少 ${pos} 位置样式`).toBe(true);return getComputedStyle(el.element as HTMLElement);};
  const bl=rule("bottomLeft"),br=rule("bottomRight"),tl=rule("topLeft"),tr=rule("topRight");
  const top=parseFloat(tl.top),bottom=parseFloat(bl.top);
  expect(top, "上排应接近顶部（top<25%）").toBeLessThan(25);
  expect(bottom, "下排应接近底部（top>75%）").toBeGreaterThan(75);
  const left=parseFloat(tl.left),right=parseFloat(tr.left);
  expect(left, "左列应接近左缘（left<35%）").toBeLessThan(35);
  expect(right, "右列应接近右缘（left>65%）").toBeGreaterThan(65);
 });
});
