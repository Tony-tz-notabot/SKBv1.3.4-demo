// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import MatchLogEntries from "./MatchLogEntries.vue";
import type {PromptRenderContext} from "../localization/promptRenderers";
import type {LogEntryLike} from "../localization/logRenderers";

const ctx:PromptRenderContext={viewerSeat:1,viewerTeam:"A",players:[{seat:1,team:"A",characterId:"character.knight"},{seat:2,team:"A",characterId:"character.ranger"},{seat:3,team:"B",characterId:"character.paladin"},{seat:4,team:"B",characterId:"character.wizard"}]};
const summary:LogEntryLike[]=[{seq:1,mode:"summary",type:"a",tokens:[{t:"char",seat:1},{t:"text",s:"攻击"},{t:"sem",s:"2",cls:"sem-normal"}]}];
const atomic:LogEntryLike[]=[{seq:2,mode:"atomic",type:"card.drawn",tokens:[{t:"char",seat:1},{t:"text",s:"摸到"},{t:"card",templateId:"support.potion",color:"green",scope:"hand:1"}]}];

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
});
