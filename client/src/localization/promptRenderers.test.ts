import {describe,expect,it} from "vitest";
import {renderPromptSegments,offerPreviewSegments,type PromptRenderContext} from "./promptRenderers";

const ctx:PromptRenderContext={viewerSeat:2,viewerTeam:"A",players:[{seat:1,team:"A",characterId:"character.knight"},{seat:2,team:"A",characterId:"character.ranger"},{seat:3,team:"B",characterId:"character.paladin"},{seat:4,team:"B",characterId:"character.wizard"}]};
const cls=(text:string)=>renderPromptSegments(prompt,ctx).find(s=>s.text===text)?.cls;
const prompt={kind:"attackResponse"};

describe("promptRenderers L1（S4）",()=>{
 it("attackResponse 主语用角色名+关系色，武器着卡牌色，伤害段着语义色",()=>{
  const segs=renderPromptSegments({kind:"attackResponse",promptData:{attackerSeat:3,targetSeat:2,weaponLabel:"剧毒之鹰",weaponColor:"green",range:2,attackTypes:["ranged"],damageSegments:[{amount:2,repeat:1,element:"none",damageType:"normal",deliveryType:"attack"},{amount:1,repeat:2,element:"poison",damageType:"normal",deliveryType:"attack",isAdditional:true}]}},ctx);
  const text=segs.map(s=>s.text).join("");
  expect(text).toContain("圣骑士");
  expect(text).toContain("剧毒之鹰");
  expect(text).toContain("远程2");
  expect(text).toContain("伤害2+1×2毒");
  expect(text).toContain("不响应将承受");
  expect(segs.find(s=>s.text==="圣骑士")!.cls).toBe("rel-enemy");
  expect(segs.find(s=>s.text.includes("剧毒之鹰"))!.cls).toBe("card-green");
  expect(segs.find(s=>s.text==="2"&&s.cls==="sem-normal")).toBeTruthy();
  expect(segs.find(s=>s.text==="毒"&&s.cls==="sem-poison")).toBeTruthy();
  expect(segs.find(s=>s.text==="你")!.cls).toBe("rel-self");
  expect(segs.find(s=>s.text==="攻击")!.cls).toBe(null);
  expect(text).toContain("攻击你");
 });
 it("dyingRescue 显示濒死者血量与来源",()=>{
  const segs=renderPromptSegments({kind:"dyingRescue",promptData:{dyingSeat:3,dyingHp:0,damageSourceSeat:1}},ctx);
  expect(segs.map(s=>s.text).join("")).toContain("圣骑士");
  expect(segs.map(s=>s.text).join("")).toContain("(0/2)");
  expect(segs.map(s=>s.text).join("")).toContain("来源");
 });
 it("判定窗口逐色列出",()=>{
  const segs=renderPromptSegments({kind:"judgmentDesignation",promptData:{colors:["red","blue"]}},ctx);
  expect(segs.map(s=>s.text).join("")).toContain("红");
  expect(segs.map(s=>s.text).join("")).toContain("蓝");
 });
 it("discardPhaseAction 显示超限需弃",()=>{
  const segs=renderPromptSegments({kind:"discardPhaseAction",promptData:{requiredCount:2,handCount:6,handLimit:4}},ctx);
  expect(segs[0]!.text).toContain("手牌6/4，需弃2张");
 });
 it("无 promptData 回退静态文案",()=>{
  expect(renderPromptSegments({kind:"playPhaseAction"},ctx)[0]!.text).toContain("出牌阶段");
  expect(renderPromptSegments({kind:"unknownKind"},ctx)[0]!.text).toBe("请完成下方操作窗口");
  expect(renderPromptSegments(null,ctx)[0]!.text).toBe("等待服务器推进");
 });
 it("offerPreviewSegments 结构化伤害+费用着色",()=>{
  const segs=offerPreviewSegments({damageStructure:[{amount:1,repeat:2,element:"poison",damageType:"shield",deliveryType:"attack"}],costSummary:"杀×1·次数×1"});
  expect(segs.find(s=>s.text==="1"&&s.cls==="sem-shield")).toBeTruthy();
  expect(segs.find(s=>s.text==="毒"&&s.cls==="sem-poison")).toBeTruthy();
  expect(segs.find(s=>s.text==="杀×1·次数×1")!.cls).toBe("sem-cost");
 });
 it("optionalTrigger/triggerOrdering 渲染效果名",()=>{
  const o=renderPromptSegments({kind:"optionalTrigger",promptData:{effectId:"talent.critical_penetration"}},ctx);
  expect(o[0]!.text).toContain("暴击穿透");
  const t=renderPromptSegments({kind:"triggerOrdering",promptData:{effects:["talent.critical_penetration","skill.taoist.attack_reflection"]}},ctx);
  expect(t.map(s=>s.text).join("")).toContain("暴击穿透");
  expect(t.map(s=>s.text).join("")).toContain("乾坤挪移");
  expect(t.find(s=>s.text==="暴击穿透"&&s.cls==="sem-extra")).toBeTruthy();
 });
 it("playPhaseAction 显示动态手牌数",()=>{
  const s=renderPromptSegments({kind:"playPhaseAction",promptData:{handCount:5,handLimit:4}},ctx);
  expect(s[0]!.text).toContain("手牌5/4");
 });
 it("engineerMechChoice/valkyrie/redLord 特殊窗口",()=>{
  expect(renderPromptSegments({kind:"engineerMechChoice",promptData:{options:["prototype","vitaminC"]}},ctx)[0]!.text).toContain("prototype");
  const v=renderPromptSegments({kind:"valkyrieBossResponse",promptData:{templateId:"boss.dark_grand_knight"}},ctx);
  expect(v[0]!.text).toContain("暗黑大骑士");
  const r=renderPromptSegments({kind:"redLordSealingHammer",promptData:{meleeTargetSeats:[2],laserTargetSeats:[3]}},ctx);
  expect(r[0]!.text).toContain("近战1候选");
 });
 it("offerPreviewSegments 无伤害时显示来源卡摘要",()=>{
  const segs=offerPreviewSegments({costSummary:null},"回复2血");
  expect(segs[0]!.text).toBe("回复2血");
 });
});
