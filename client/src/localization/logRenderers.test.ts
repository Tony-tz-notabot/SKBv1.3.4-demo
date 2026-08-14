import {describe,expect,it} from "vitest";
import type {LogEntryView} from "@skb-protocol/client-protocol";
import {cardNameById} from "./promptRenderers";
import {renderLogEntry,logContextFromSnapshot} from "./logRenderers";

const ctx={viewerSeat:2,viewerTeam:"A",players:[{seat:1,team:"A",characterId:"character.knight"},{seat:2,team:"A",characterId:"character.ranger"},{seat:3,team:"B",characterId:"character.paladin"},{seat:4,team:"B",characterId:"character.wizard"}]};
const entry:LogEntryView={seq:1,mode:"summary",type:"attack.target.after",tokens:[{t:"char",seat:1},{t:"text",s:"用"},{t:"card",templateId:"weapon.w08",color:"green",scope:"public"},{t:"text",s:"攻击"},{t:"char",seat:3},{t:"text",s:"：命中，护盾-"},{t:"sem",s:"1",cls:"sem-shield"}]};

describe("logRenderers",()=>{
 it("token 映射：char→角色名+关系色、card→【牌名】+卡牌色、sem→原样、text→无 cls",()=>{
  const segs=renderLogEntry(entry,ctx);
  expect(segs[0]).toEqual({text:"骑士",cls:"rel-ally"});
  expect(segs[2]).toEqual({text:`【${cardNameById("weapon.w08")}】`,cls:"card-green"});
  expect(segs[4]).toEqual({text:"圣骑士",cls:"rel-enemy"});
  expect(segs[6]).toEqual({text:"1",cls:"sem-shield"});
  expect(segs[1]!.cls).toBeNull();
 });
 it("关系色三视角：自己 rel-self / 队友 rel-ally / 敌 rel-enemy",()=>{
  const of=(seat:number)=>renderLogEntry({seq:1,mode:"summary",type:"t",tokens:[{t:"char",seat}]},ctx)[0]!;
  expect(of(1)).toEqual({text:"骑士",cls:"rel-ally"});
  expect(of(2)).toEqual({text:"游侠",cls:"rel-self"});
  expect(of(3)).toEqual({text:"圣骑士",cls:"rel-enemy"});
 });
 it("ability token → abilityDisplayName + sem-extra",()=>{
  const segs=renderLogEntry({seq:1,mode:"summary",type:"t",tokens:[{t:"char",seat:1},{t:"text",s:"发动"},{t:"ability",id:"skill.knight.instinct"}]},ctx);
  expect(segs[2]!.text).toBe("骑士本能");
  expect(segs[2]!.cls).toBe("sem-extra");
 });
 it("渲染文本不含「你」",()=>{
  expect(renderLogEntry(entry,ctx).map(s=>s.text).join("")).not.toContain("你");
 });
 it("logContextFromSnapshot 从快照构造 ctx（含已淘汰玩家）",()=>{
  const snap={viewer:{seat:1,team:"A"},publicView:{players:[{seat:1,team:"A",characterId:"character.knight"},{seat:3,team:"B",characterId:null}]}} as any;
  const c=logContextFromSnapshot(snap);
  expect(c.viewerSeat).toBe(1);
  expect(c.viewerTeam).toBe("A");
  expect(c.players).toHaveLength(2);
 });
});
