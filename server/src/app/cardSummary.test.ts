import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {buildCardSummary} from "./cardSummary.js";

// S3：卡牌简洁摘要——武器伤害/耐久动态值、基础牌回复量。数值随 runtime 变化。

let ruleset:LoadedRuleset;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});

describe("卡牌 summary 生成（S3）",()=>{
 it("武器摘要含射程与伤害（默认模式）",()=>{
  const s=buildCardSummary(ruleset,"weapon.w08",{});
  expect(s).toContain("远程");
  expect(s).toContain("伤害2");
 });
 it("扳手 w61 摘要随耐久变化",()=>{
  expect(buildCardSummary(ruleset,"weapon.w61",{durabilityCurrent:3})).toContain("伤害1×3");
  expect(buildCardSummary(ruleset,"weapon.w61",{durabilityCurrent:5})).toContain("伤害1×5");
 });
 it("蓄力武器摘要标注当前蓄力档",()=>{
  const s=buildCardSummary(ruleset,"weapon.w03",{charge:2});
  expect(s).toContain("蓄力2");
 });
 it("基础药水/号角/杀/闪摘要",()=>{
  expect(buildCardSummary(ruleset,"basic.potion.white",{})).toContain("回复2");
  expect(buildCardSummary(ruleset,"basic.horn.red",{})).toContain("必暴");
  expect(buildCardSummary(ruleset,"basic.kill.white",{})).toContain("【杀】");
  expect(buildCardSummary(ruleset,"basic.dodge.white",{})).toContain("抵消");
 });
 it("未覆盖卡牌返回空串（客户端回退本地描述）",()=>{
  expect(buildCardSummary(ruleset,"statue.wizard",{})).toBe("");
 });
});
