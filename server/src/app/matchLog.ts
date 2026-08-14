import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState,Seat,Team} from "../engine/state.js";
import type {JsonValue} from "../engine/types.js";
import type {AppRoom} from "./types.js";

// 对局日志系统：服务端在事件发生时刻用当时的提交后状态构建规范日志条目（含隐私作用域），
// 按观众过滤后随 GAME_SNAPSHOT.log 下发；每局结束写 JSON 文件。设计见 docs/整理/129。
// 服务端负责句子骨架组合+语义分类+卡牌印刷色；客户端只负责 char→角色名+关系色、
// card→牌名+卡牌色、ability→技能名、sem→语义色。不出现"你"。

export type LogToken =
  | {t:"text"; s:string}
  | {t:"char"; seat:Seat}
  | {t:"card"; templateId:string; color:string; scope:string}
  | {t:"ability"; id:string}
  | {t:"sem"; s:string; cls:string};

export interface LogEntry {seq:number; mode:"summary"|"atomic"; type:string; tokens:LogToken[]}
export interface GameLogPlayer {seat:Seat; userId:string; displayName:string; characterId:string; team:Team}
export interface GameLogMeta {gameId:string; roomId:string; roomCode:string; rulesetVersion:string; firstSeat:Seat; startedAt:number; players:GameLogPlayer[]}
export interface GameLog {meta:GameLogMeta; entries:LogEntry[]; lastLogEventSeq:number; seqCounter:number; finalized:boolean; endedAt?:number}

// 对局结束落盘的完整记录（含权威原始领域事件，可重放）。
export interface MatchLogFile {
  version:1; gameId:string; roomId:string; roomCode:string; rulesetVersion:string;
  startedAt:number; endedAt:number; winnerTeam:"A"|"B"|null; forfeited:boolean; forfeitedBySeat:Seat|null; firstSeat:Seat;
  players:GameLogMeta["players"]; summary:LogEntry[]; atomic:LogEntry[];
  events:Array<{eventSeq:number; stateRevision:number; eventType:string; payload:JsonValue}>;
}
export interface MatchLogSink {save(gameId:string, payload:MatchLogFile):Promise<void>}

interface CardFact {cardId:string; displayName:string; category:string; color:string; resourceKey:string}

const text=(s:string):LogToken=>({t:"text",s});
const char=(seat:number):LogToken=>({t:"char",seat:seat as Seat});
const sem=(s:string,cls:string):LogToken=>({t:"sem",s,cls});
const ability=(id:string):LogToken=>({t:"ability",id});

const seatOfRef=(ref:unknown):Seat|undefined=>{if(typeof ref!=="string")return undefined;const m=/^(?:character:|public:seat_)([1-4])$/.exec(ref);return m?Number(m[1]) as Seat:undefined;};
const seatOf=(v:unknown):Seat|undefined=>{if(typeof v==="number"&&v>=1&&v<=4)return v as Seat;return seatOfRef(v);};
const num=(v:unknown):number=>typeof v==="number"&&Number.isFinite(v)?v:0;
const strVal=(v:unknown):string=>typeof v==="string"?v:"";

const PHASE_NAMES:Record<string,string>={prepare:"准备",judgment:"判定",draw:"摸牌",play:"出牌",discard:"弃牌",end:"结束"};
const phaseName=(p:string)=>PHASE_NAMES[p]??p;
const COLOR_NAMES:Record<string,string>={white:"白",green:"绿",blue:"蓝",orange:"橙",red:"红",none:"无"};
const ELEMENT_TEXT:Record<string,string>={fire:"火",poison:"毒",electric:"感电"};
const ELEMENT_CLS:Record<string,string>={fire:"sem-fire",poison:"sem-poison",electric:"sem-electric"};

function scopeOf(state:AuthoritativeGameState,ref:string):string{
 const card=state.cards[ref];if(!card)return"hidden";
 if(card.zoneRef.startsWith("hand:"))return`hand:${card.zoneRef.split(":")[1]??card.ownerSeat??1}`;
 return card.faceUp?"public":"hidden";
}

export function initGameLog(room:AppRoom):GameLog{
 const game=room.game!;
 const players:GameLogPlayer[]=game.players.map(sp=>{
  const rp=room.players.find(x=>x.seat===sp.seat);
  return{seat:sp.seat,userId:sp.userId,displayName:rp?.displayName??sp.userId,characterId:sp.characterId??"",team:sp.team};
 });
 return{meta:{gameId:game.gameId,roomId:room.roomId,roomCode:room.roomCode,rulesetVersion:room.settings.rulesetVersion,firstSeat:game.setup?.firstSeat??1,startedAt:Date.now(),players},entries:[],lastLogEventSeq:0,seqCounter:0,finalized:false};
}

// 按观众过滤规范条目为 wire 视图：手牌只有本人可见牌名，其余折叠为"一张牌"；
// 摸牌类条目在全部卡牌不可见时折叠为"N张牌"。观战（viewerSeat=null）同公开视角。
export function projectLogView(entries:LogEntry[],viewerSeat:number|null,cap=200):LogEntry[]{
 return entries.slice(-cap).map(entry=>{
  const invisible:number[]=[];const cardCount=entry.tokens.filter(t=>t.t==="card").length;
  const tokens=entry.tokens.map((tok,i)=>{
   if(tok.t!=="card")return tok;
   if(tok.scope==="public")return tok;
   if(tok.scope.startsWith("hand:")&&viewerSeat!==null&&Number(tok.scope.slice(5))===viewerSeat)return tok;
   invisible.push(i);return text("一张牌");
  });
  if(entry.type==="card.drawn"&&invisible.length>0&&invisible.length===cardCount){
   const first=invisible[0]!;const last=invisible[invisible.length-1]!;
   return{...entry,tokens:[...tokens.slice(0,first),text(`${invisible.length}张牌`),...tokens.slice(last+1)]};
  }
  return{...entry,tokens};
 });
}

export class MatchLogBuilder{
 private cardFacts:Map<string,CardFact>;
 private attackFrames=new Map<string,{attackerSeat:Seat;weaponTemplateId?:string;weaponColor?:string}>();
 constructor(private ruleset:LoadedRuleset,private store:MatchLogSink){
  const cards=(ruleset.documents.get("cards.json") as {items:CardFact[]}|undefined)?.items??[];
  this.cardFacts=new Map(cards.map(x=>[x.cardId,x]));
 }
 sync(room:AppRoom):void{
  const game=room.game;if(!game)return;
  if(!room.gameLog)room.gameLog=initGameLog(room);
  const log=room.gameLog;
  for(const ev of game.history.domainEvents){
   if(ev.eventSeq<=log.lastLogEventSeq)continue;
   this.updateFrames(game,ev);
   const atomic=this.atomicEntry(game,ev);
   if(atomic){atomic.seq=++log.seqCounter;log.entries.push(atomic);}
   const summary=this.summaryEntry(game,ev);
   if(summary){summary.seq=++log.seqCounter;log.entries.push(summary);}
   log.lastLogEventSeq=ev.eventSeq;
  }
  if(game.lifecycle==="ended"&&!log.finalized){
   log.finalized=true;log.endedAt=Date.now();
   void this.store.save(log.meta.gameId,this.buildFile(room,log)).catch((error)=>console.error("SKB match log save error",error));
  }
 }
 private obj(p:JsonValue|undefined):Record<string,any>{return(p??{}) as Record<string,any>;}
 private seatNum(p:Record<string,any>,...keys:string[]):Seat|undefined{for(const k of keys){const s=seatOf(p[k]);if(s)return s;}return undefined;}
 private cardToken(state:AuthoritativeGameState,ref:unknown):LogToken|null{
  const r=strVal(ref);if(!r||seatOfRef(r))return null;
  const card=state.cards[r];if(!card)return null;
  return{t:"card",templateId:card.templateId,color:this.cardFacts.get(card.templateId)?.color??"none",scope:scopeOf(state,r)};
 }
 private card1(state:AuthoritativeGameState,ref:unknown):LogToken{return this.cardToken(state,ref)??text("一张牌");}
 private cards(state:AuthoritativeGameState,refs:unknown):LogToken[]{const list=Array.isArray(refs)?refs:[];return list.map((r,i)=>this.card1(state,r??(i===0?refs:undefined)));}
 private elementWord(element:unknown):LogToken[]{const e=strVal(element);const name=ELEMENT_TEXT[e];if(!name)return[];return[sem(name,ELEMENT_CLS[e]??"sem-extra")];}

 private updateFrames(state:AuthoritativeGameState,ev:any):void{
  const p=this.obj(ev.payload);const attackId=strVal(p.attackId);if(!attackId)return;
  if(ev.eventType==="attack.declare"){const attacker=this.seatNum(p,"attackerSeat");if(attacker)this.attackFrames.set(attackId,{attackerSeat:attacker});}
  else if(ev.eventType==="attack.weapon.resolve"){
   const frame=this.attackFrames.get(attackId);if(!frame)return;
   const card=state.cards[strVal(p.weaponRef)];if(card){frame.weaponTemplateId=card.templateId;frame.weaponColor=this.cardFacts.get(card.templateId)?.color??"none";}
  }else if(ev.eventType==="attack.resolved"||ev.eventType==="attack.after"||ev.eventType==="attack.invalidated"||ev.eventType==="attack.cancelled"){
   this.attackFrames.delete(attackId);
  }
 }

 private abilityId(p:Record<string,any>):string{
  if(strVal(p.abilityId))return strVal(p.abilityId);
  const trigger=strVal(p.triggerId);if(trigger)return trigger.split(":")[0]!;
  return strVal(p.familyId);
 }

 // ---- 原子模式：逐事件一行 ----
 private atomicEntry(state:AuthoritativeGameState,ev:any):LogEntry|null{
  const p=this.obj(ev.payload);const type=ev.eventType;
  const seat=this.seatNum(p,"seat","actorSeat","ownerSeat","controllerSeat","attackerSeat","responderSeat","sourceSeat");
  const target=seatOfRef(p.targetRef??p.dyingRef??p.ownerRef);
  const tok=(tokens:LogToken[]):LogEntry=>({seq:0,mode:"atomic",type,tokens});
  switch(type){
   case"game.start":{const first=this.seatNum(p,"firstSeat");return first?tok([text("对局开始，"),char(first),text("先行")]):null;}
   case"turn.start":{const s=this.seatNum(p,"seat");if(!s)return null;const round=num(p.round);return tok([text(`第${round}回合 `),char(s),text(" 回合开始")]);}
   case"turn.end":{const s=this.seatNum(p,"seat");return s?tok([text(`第${num(p.round)}回合 结束`)]):null;}
   case"phase.before":
   case"phase.start":{const s=this.seatNum(p,"seat","activeSeat");const ph=strVal(p.phase);return s&&ph?tok([char(s),text(` 进入 ${phaseName(ph)} 阶段`)]):null;}
   case"phase.skip":{const s=this.seatNum(p,"seat","activeSeat");const ph=strVal(p.phase);return s&&ph?tok([char(s),text(` 跳过 ${phaseName(ph)} 阶段`)]):null;}
   case"phase.end":{const s=this.seatNum(p,"seat","activeSeat");const ph=strVal(p.phase);return s&&ph?tok([char(s),text(` 结束 ${phaseName(ph)} 阶段`)]):null;}
   case"card.drawn":{if(!seat)return null;return tok([char(seat),text("摸到"),...this.cards(state,p.cardRefs??(p.cardRef?[p.cardRef]:[]))]);}
   case"card.played":{if(!seat)return null;return tok([char(seat),text("打出"),this.card1(state,p.cardRef)]);}
   case"card.equipped":{if(!seat)return null;return tok([char(seat),text("装备"),this.card1(state,p.cardRef??p.equippedRef)]);}
   case"card.synthesized":{if(!seat)return null;return tok([char(seat),text("合成"),this.card1(state,p.cardRef??p.productRef??p.resultRef)]);}
   case"card.discarded":{if(!seat)return null;return tok([char(seat),text("弃置"),...this.cards(state,p.cardRefs??(p.cardRef?[p.cardRef]:[]))]);}
   case"card.dismantled":{if(!seat)return null;return tok([char(seat),text("拆除"),this.card1(state,p.cardRef)]);}
   case"card.lost":{return tok([char(this.seatNum(p,"seat","ownerSeat")??1),text("失去"),this.card1(state,p.cardRef)]);}
   case"card.gained":{if(!seat)return null;return tok([char(seat),text("获得"),this.card1(state,p.cardRef)]);}
   case"card.transformed":{return tok([this.card1(state,p.fromRef??p.cardRef),text(" 变为 "),this.card1(state,p.toRef??p.newRef)]);}
   case"card.responded":{if(!seat)return null;return tok([char(seat),text("打出"),this.card1(state,p.cardRef),text(" 响应")]);}
   case"card.revealed":
   case"cards.displayed":{return tok([text("公开："),this.card1(state,p.cardRef??(p.cardRefs?.[0]))]);}
   case"card.effect.resolved":{
    if(p.category==="statue"||strVal(p.cardId).startsWith("statue.")){
     const owner=this.seatNum(p,"seat","ownerSeat")??seatOfRef(p.targetRef);
     return tok([...(owner?[char(owner)]:[]),text("雕像 "),this.card1(state,p.cardRef),text(" 结算")]);
    }
    return null;
   }
   case"attack.declare":{const s=this.seatNum(p,"attackerSeat");return s?tok([char(s),text(" 发动攻击")]):null;}
   case"attack.weapon.resolve":{const s=this.seatNum(p,"attackerSeat")??this.attackFrames.get(strVal(p.attackId))?.attackerSeat;return s?tok([char(s),text(" 用 "),this.card1(state,p.weaponRef)]):null;}
   case"attack.targeted":{
    const refs=Array.isArray(p.targetRefs)?p.targetRefs.map(seatOfRef).filter((x):x is Seat=>x!==undefined):[];
    return refs.length?tok([text("攻击目标："),...refs.map(char)]):null;
   }
   case"damage.applied":{
    const t=seatOfRef(p.targetRef);if(!t)return null;
    return tok([text("对"),char(t),text(" 造成 "),sem(String(num(p.actualDamage)),"sem-normal"),...this.elementWord(p.element),text(" 伤害")]);
   }
   case"damage.prevented":{const t=seatOfRef(p.targetRef);return t?tok([char(t),text(" 的伤害被抵消")]):null;}
   case"health.hpLost":{if(!seat)return null;return tok([char(seat),text("失去 "),sem(String(num(p.amount)),"sem-hp"),text(" 生命")]);}
   case"shield.shieldLost":{if(!seat)return null;return tok([char(seat),text("失去 "),sem(String(num(p.amount)),"sem-shield"),text(" 护盾")]);}
   case"shield.broken":{if(!seat)return null;return tok([char(seat),text(" 的护盾被击破")]);}
   case"hp.recovered":
   case"health.recovered":{if(!seat)return null;return tok([char(seat),text("恢复 "),sem(String(num(p.amount)),"sem-heal"),text(" 生命")]);}
   case"shield.recovered":{if(!seat)return null;return tok([char(seat),text("恢复 "),sem(String(num(p.amount)),"sem-shield"),text(" 护盾")]);}
   case"status.applied":
   case"status.refreshed":
   case"status.stacked":{const s=this.seatNum(p,"ownerSeat")??target;const id=strVal(p.statusId);return s&&id?tok([char(s),text(` 获得状态【${id}】`)]):null;}
   case"status.removed":
   case"status.expired":{const s=this.seatNum(p,"ownerSeat")??target;const id=strVal(p.statusId);return s&&id?tok([char(s),text(` 失去状态【${id}】`)]):null;}
   case"status.prevented":{const s=this.seatNum(p,"ownerSeat")??target;const id=strVal(p.statusId);return s&&id?tok([char(s),text(` 免疫状态【${id}】`)]):null;}
   case"dying.enter":{return target?tok([char(target),text(" 濒死")]):null;}
   case"dying.rescued":{
    const r=this.seatNum(p,"rescuerSeat")??this.seatNum(p,"seat");
    return target&&r?tok([char(r),text(" 救援 "),char(target),text("（回到"),sem(String(num(p.hp)),"sem-heal"),text("血）")]):null;
   }
   case"death.occurred":{return target?tok([char(target),text(" 死亡")]):null;}
   case"elimination.occurred":{return target?tok([char(target),text(" 被淘汰")]):null;}
   case"game.victory":{return tok([text(`${strVal(p.winnerTeam)}队`),sem("胜利","sem-extra")]);}
   case"game.aborted":{return tok([text("对局中止")]);}
   case"judgment.card.revealed":{
    const color=COLOR_NAMES[strVal(p.printedColor)];
    return tok([text("判定翻开 "),this.card1(state,p.cardRef),...(color?[text(`（${color}）`)]:[])]);}
   case"judgment.finalized":{
    const from=COLOR_NAMES[strVal(p.printedColor)]??strVal(p.from),to=COLOR_NAMES[strVal(p.finalColor)]??strVal(p.to);
    return tok([text(`判定结果 ${from??"?"}→${to??"?"}`)]);}
   case"response.resolved":
   case"response.committed":{const s=this.seatNum(p,"responderSeat")??seat;return s?tok([char(s),text(" 响应")]):null;}
   case"response.passed":{const s=this.seatNum(p,"responderSeat")??seat;return s?tok([char(s),text(" 放弃")]):null;}
   case"deck.reshuffled":{return tok([text("牌库洗牌（"),sem(String(num(p.count)),"sem-cost"),text("张）")]);}
   case"deck.exhausted":{return tok([text("牌库耗尽")]);}
   case"ability.resolved":
   case"trigger.resolved":{const s=this.seatNum(p,"controllerSeat")??seat;const id=this.abilityId(p);return s&&id?tok([char(s),text(" 发动 "),ability(id)]):null;}
   case"ability.passed":
   case"trigger.passed":{const s=this.seatNum(p,"controllerSeat")??seat;const id=this.abilityId(p);return s&&id?tok([char(s),text(" 放弃发动 "),ability(id)]):null;}
   case"boss.use.declared":
   case"boss.use.committed":{if(!seat)return null;return tok([char(seat),text(" 使用 BOSS "),this.card1(state,p.cardRef)]);}
   default:return null;
  }
 }

 // ---- 摘要模式：结果事件聚合，每动作一行 ----
 private summaryEntry(state:AuthoritativeGameState,ev:any):LogEntry|null{
  const p=this.obj(ev.payload);const type=ev.eventType;
  const seat=this.seatNum(p,"seat","actorSeat","ownerSeat","controllerSeat");
  const tok=(tokens:LogToken[]):LogEntry=>({seq:0,mode:"summary",type,tokens});
  switch(type){
   case"attack.target.after":{
    const target=seatOfRef(p.targetRef);if(!target)return null;
    const frame=this.attackFrames.get(strVal(p.attackId));
    const attacker=frame?.attackerSeat??this.seatNum(p,"attackerSeat");if(!attacker)return null;
    const tokens:LogToken[]=[char(attacker)];
    if(frame?.weaponTemplateId)tokens.push(text("用"),{t:"card",templateId:frame.weaponTemplateId,color:frame.weaponColor??"none",scope:"public"});
    else{const src=this.cardToken(state,p.sourceRef);if(src)tokens.push(text("用"),src);}
    tokens.push(text(" 攻击 "),char(target));
    if(p.hit===true){
     tokens.push(text("：命中"));
     const shield=num(p.actualShieldLoss),hp=num(p.actualHpLoss),special=num(p.actualSpecialLayerLoss);
     if(shield>0||hp>0||special>0){tokens.push(text("，"));if(shield>0){tokens.push(sem(`护盾-${shield}`,"sem-shield"));if(hp>0||special>0)tokens.push(text(" "));}if(hp>0){tokens.push(sem(`血-${hp}`,"sem-hp"));if(special>0)tokens.push(text(" "));}if(special>0)tokens.push(text(`特殊层-${special}`));}
    }else tokens.push(text("：未命中"));
    return tok(tokens);
   }
   case"card.played":{if(strVal(p.purpose).startsWith("attack."))return null;if(!seat)return null;return tok([char(seat),text(" 打出"),this.card1(state,p.cardRef)]);}
   case"card.equipped":{if(!seat)return null;return tok([char(seat),text(" 装备"),this.card1(state,p.cardRef??p.equippedRef)]);}
   case"card.synthesized":{if(!seat)return null;return tok([char(seat),text(" 合成"),this.card1(state,p.cardRef??p.productRef??p.resultRef)]);}
   case"card.discarded":{if(strVal(p.reason)==="initialRedraw")return null;if(!seat)return null;return tok([char(seat),text(" 弃置"),this.card1(state,p.cardRef)]);}
   case"card.dismantled":{if(!seat)return null;return tok([char(seat),text(" 拆除"),this.card1(state,p.cardRef)]);}
   case"card.lost":{return tok([char(this.seatNum(p,"seat","ownerSeat")??1),text(" 失去"),this.card1(state,p.cardRef)]);}
   case"ability.resolved":
   case"trigger.resolved":{const s=this.seatNum(p,"controllerSeat")??seat;const id=this.abilityId(p);return s&&id?tok([char(s),text(" 发动 "),ability(id)]):null;}
   case"hp.recovered":
   case"health.recovered":{if(!seat)return null;return tok([char(seat),text(" 恢复 "),sem(String(num(p.amount)),"sem-heal"),text(" 生命")]);}
   case"card.effect.resolved":{
    if(p.category==="statue"||strVal(p.cardId).startsWith("statue.")){
     const owner=this.seatNum(p,"seat","ownerSeat")??seatOfRef(p.targetRef);
     return tok([...(owner?[char(owner)]:[]),text("雕像 "),this.card1(state,p.cardRef),text(" 结算")]);
    }
    return null;
   }
   case"dying.rescued":{
    const target=seatOfRef(p.dyingRef);const r=this.seatNum(p,"rescuerSeat")??this.seatNum(p,"seat");
    return target&&r?tok([char(r),text(" 救援 "),char(target)]):null;
   }
   case"death.occurred":{const t=seatOfRef(p.dyingRef);return t?tok([char(t),text(" 死亡")]):null;}
   case"elimination.occurred":{const t=seatOfRef(p.dyingRef);return t?tok([char(t),text(" 被淘汰")]):null;}
   case"game.victory":{return tok([text(`${strVal(p.winnerTeam)}队`),sem("胜利","sem-extra")]);}
   case"game.aborted":{return tok([text("对局中止")]);}
   case"judgment.finalized":{
    const from=COLOR_NAMES[strVal(p.printedColor)]??strVal(p.from),to=COLOR_NAMES[strVal(p.finalColor)]??strVal(p.to);
    return tok([text(`判定：${from??"?"}→${to??"?"}`)]);}
   case"turn.start":{const s=this.seatNum(p,"seat");return s?tok([text(`— 第${num(p.round)}回合 `),char(s),text(" —")]):null;}
   default:return null;
  }
 }

 private buildFile(room:AppRoom,log:GameLog):MatchLogFile{
  const game=room.game!;
  return{
   version:1,gameId:game.gameId,roomId:room.roomId,roomCode:room.roomCode,rulesetVersion:room.settings.rulesetVersion,
   startedAt:log.meta.startedAt,endedAt:log.endedAt??Date.now(),winnerTeam:game.winnerTeam??null,
   forfeited:game.forfeited===true,forfeitedBySeat:game.forfeitedBySeat??null,firstSeat:log.meta.firstSeat,
   players:log.meta.players,summary:log.entries.filter(e=>e.mode==="summary"),atomic:log.entries.filter(e=>e.mode==="atomic"),
   events:game.history.domainEvents.map(e=>({eventSeq:e.eventSeq,stateRevision:e.stateRevision,eventType:e.eventType,payload:e.payload})),
  };
 }
}
