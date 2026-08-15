// @vitest-environment jsdom
import {mount, flushPromises} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import {nextTick} from "vue";
import MatchLogEntries from "./MatchLogEntries.vue";
import type {PromptRenderContext} from "../localization/promptRenderers";
import type {LogEntryLike} from "../localization/logRenderers";

const ctx:PromptRenderContext={viewerSeat:1,viewerTeam:"A",players:[{seat:1,team:"A",characterId:"character.knight"},{seat:2,team:"A",characterId:"character.ranger"},{seat:3,team:"B",characterId:"character.paladin"},{seat:4,team:"B",characterId:"character.wizard"}]};
const summary:LogEntryLike[]=[{seq:1,mode:"summary",type:"a",tokens:[{t:"char",seat:1},{t:"text",s:"攻击"},{t:"sem",s:"2",cls:"sem-normal"}]}];
const atomic:LogEntryLike[]=[{seq:2,mode:"atomic",type:"card.drawn",tokens:[{t:"char",seat:1},{t:"text",s:"摸到"},{t:"card",templateId:"support.potion",color:"green",scope:"hand:1"}]}];

/** jsdom 不实现布局：mock 滚动尺寸，模拟"可滚动列表"。 */
function mockScroll(el:HTMLElement,scrollHeight:number,clientHeight:number){
 Object.defineProperty(el,"scrollHeight",{configurable:true,value:scrollHeight});
 Object.defineProperty(el,"clientHeight",{configurable:true,value:clientHeight});
}

describe("MatchLogEntries 对局日志面板",()=>{
 it("默认摘要模式只渲染 summary 条目",()=>{
  const w=mount(MatchLogEntries,{props:{entries:[...summary,...atomic],ctx}});
  expect(w.findAll(".game-log__list li")).toHaveLength(1);
  expect(w.text()).toContain("攻击");
  expect(w.text()).not.toContain("摸到");
 });
 it("点「详细」切换到 atomic 条目",async()=>{
  const w=mount(MatchLogEntries,{props:{entries:[...summary,...atomic],ctx}});
  await w.findAll(".game-log__tabs button")[1]!.trigger("click");
  expect(w.findAll(".game-log__list li")).toHaveLength(1);
  expect(w.text()).toContain("摸到");
 });
 it("token 着色 span：char 关系色/card 卡牌色，文本无「你」",async()=>{
  const w=mount(MatchLogEntries,{props:{entries:atomic,ctx}});
  await w.findAll(".game-log__tabs button")[1]!.trigger("click");
  const spans=w.findAll(".game-log__list li span");
  expect(spans.some(s=>s.classes().includes("rel-self"))).toBe(true);
  expect(spans.some(s=>s.classes().includes("card-green"))).toBe(true);
  expect(spans.map(s=>s.text()).join("")).not.toContain("你");
 });
 it("entries 为空不抛错",()=>{
  const w=mount(MatchLogEntries,{props:{entries:[],ctx}});
  expect(w.findAll(".game-log__list li")).toHaveLength(0);
 });
 it("新日志追加且停留在底部附近时自动滚到底部",async()=>{
  const w=mount(MatchLogEntries,{props:{entries:summary,ctx}});
  const ol=w.find(".game-log__list").element as HTMLElement;
  mockScroll(ol,600,200);
  await flushPromises();
  expect(ol.scrollTop).toBe(600); // 初始强制滚到底（jsdom clamp 到 scrollHeight-clientHeight）
  const more:LogEntryLike[]=[...summary,{seq:2,mode:"summary",type:"b",tokens:[{t:"text",s:"新条目"}]}];
  await w.setProps({entries:more});
  await flushPromises();
  expect(ol.scrollTop).toBe(600);
 });
 it("玩家上滑看历史时新日志不强制拉回",async()=>{
  const w=mount(MatchLogEntries,{props:{entries:summary,ctx}});
  const ol=w.find(".game-log__list").element as HTMLElement;
  mockScroll(ol,600,200);
  await flushPromises();
  ol.scrollTop=150; // 玩家主动上滑查看历史
  await w.setProps({entries:[...summary,{seq:2,mode:"summary",type:"b",tokens:[{t:"text",s:"新条目"}]}]});
  await flushPromises();
  expect(ol.scrollTop).toBe(150);
 });
 it("模式切换后停留在底部则滚到底部",async()=>{
  const w=mount(MatchLogEntries,{props:{entries:atomic,ctx}});
  const ol=w.find(".game-log__list").element as HTMLElement;
  mockScroll(ol,600,200);
  await flushPromises();
  await w.findAll(".game-log__tabs button")[1]!.trigger("click");
  await flushPromises();
  expect(ol.scrollTop).toBe(600);
 });
});
