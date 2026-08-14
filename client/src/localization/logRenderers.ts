import type {GameSnapshot} from "@skb-protocol/client-protocol";
import type {DeepReadonly} from "vue";
import type {PromptSegment,PromptRenderContext} from "./promptRenderers";
import {cardNameById,cardCls,characterName,relationshipCls} from "./promptRenderers";
import {abilityDisplayName} from "./descriptions";

// 对局日志渲染：服务端已组合句子骨架并标注 token 类型（char/card/ability/sem），
// 客户端只负责解析名称与上色——char→角色名+关系色、card→牌名+卡牌色、
// ability→技能名、sem→语义色。全文不用"你"。
// 宽容结构（seat 用 number、tokens 只读）：兼容 GAME_SNAPSHOT.log 的 DeepReadonly 与赛后 API 的可变数组。

type SemCls="sem-normal"|"sem-shield"|"sem-hp"|"sem-heal"|"sem-cost"|"sem-fire"|"sem-poison"|"sem-electric"|"sem-frozen"|"sem-extra";
export type LogEntryLike = {
  seq:number; mode:"summary"|"atomic"; type:string;
  tokens: readonly ({t:"text"; s:string}|{t:"char"; seat:number}|{t:"card"; templateId:string; color:string; scope:string}|{t:"ability"; id:string}|{t:"sem"; s:string; cls:SemCls})[];
};

export function logContextFromSnapshot(snap:DeepReadonly<GameSnapshot>):PromptRenderContext{
 return{viewerSeat:snap.viewer.seat,viewerTeam:snap.viewer.team,players:snap.publicView.players.map(p=>({seat:p.seat,team:p.team,characterId:p.characterId}))};
}
export function renderLogEntry(entry:LogEntryLike,ctx:PromptRenderContext):PromptSegment[]{
 return entry.tokens.map(tok=>{
  if(tok.t==="text")return{text:tok.s,cls:null};
  if(tok.t==="char")return{text:characterName(ctx,tok.seat),cls:relationshipCls(ctx,tok.seat)};
  if(tok.t==="card")return{text:`【${cardNameById(tok.templateId)}】`,cls:cardCls(tok.color)};
  if(tok.t==="ability")return{text:abilityDisplayName(tok.id)||tok.id,cls:"sem-extra"};
  return{text:tok.s,cls:tok.cls};
 });
}
