import type { LoadedRuleset } from "../ruleset/types.js";
import { drawCardsInTransaction } from "./deck.js";
import { applyStatusInTransaction } from "./status.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import { matchTriggeredEffects, type MatchedTriggerCandidate, type TriggerEventFact } from "./triggerRegistry.js";
import type { JsonValue, TransactionCommit } from "./types.js";

type EffectRecord=Record<string,JsonValue>;
const effectRecord=(value:JsonValue):EffectRecord=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("TRIGGER_EFFECT_INVALID");return value as EffectRecord;};
const paramsOf=(effect:EffectRecord):EffectRecord=>effectRecord(effect.params??{});
function targetSeat(state:AuthoritativeGameState,candidate:MatchedTriggerCandidate,event:TriggerEventFact,target:JsonValue|undefined):Seat{
  if(target==="$controller")return candidate.controllerSeat;
  const ref=target==="$event.target"?event.payload.targetRef??event.payload.dyingRef:target;
  if(typeof ref==="string"){const match=/^character:([1-4])$/.exec(ref);if(match)return Number(match[1]) as Seat;}
  throw new Error("TRIGGER_TARGET_UNRESOLVED");
}
function scheduleDamage(tx:EngineTransaction<AuthoritativeGameState>,candidate:MatchedTriggerCandidate,event:TriggerEventFact,effect:EffectRecord):void{
  const params=paramsOf(effect),seat=targetSeat(tx.draft,candidate,event,effect.target),attack=tx.draft.combat.attack&&typeof tx.draft.combat.attack==="object"&&!Array.isArray(tx.draft.combat.attack)?tx.draft.combat.attack as EffectRecord:null;
  if(attack&&typeof event.payload.attackId==="string"&&event.payload.attackId===attack.attackId){const segments=Array.isArray(attack.damageSegments)?attack.damageSegments:[],segmentId=`trigger:${candidate.familyId}:${seat}:${segments.length}`;attack.damageSegments=[...segments,{segmentId,deliveryType:String(params.deliveryType??"direct"),attackType:"effect",damageType:String(params.damageType??"normal"),element:String(params.element??"none"),amount:Number(params.amount),repeat:1,isAdditional:params.isAdditional===true,overflowPolicy:"normal"}];tx.emit("damage.segment.added",{attackId:String(attack.attackId),sourceSeat:candidate.controllerSeat,targetSeat:seat,sourceId:candidate.familyId,segmentId,element:String(params.element??"none"),amount:Number(params.amount)});return;}
  const scheduledId=`scheduled:trigger-damage:${candidate.triggerId}:${tx.draft.stateRevision+1}:${tx.draft.scheduledEffects.length}`;tx.draft.scheduledEffects.push({scheduledId,sourceRef:candidate.sourceRef,controllerSeat:candidate.controllerSeat,executeAt:"immediate.damagePipeline",effect:{op:"createDamage",targetRef:`character:${seat}`,amount:Number(params.amount),damageType:String(params.damageType??"normal"),element:String(params.element??"none"),isAdditional:params.isAdditional===true,ignoreArmor:params.ignoreArmor===true},cancelled:false});tx.emit("effect.scheduled",{scheduledId,triggerId:candidate.triggerId,kind:"createDamage",targetSeat:seat});
}
function executeOne(tx:EngineTransaction<AuthoritativeGameState>,ruleset:LoadedRuleset,candidate:MatchedTriggerCandidate,event:TriggerEventFact,raw:JsonValue):void{
  const effect=effectRecord(raw),op=String(effect.op),params=paramsOf(effect);
  if(op==="recoverHp"||op==="recoverShield"){
    const seat=targetSeat(tx.draft,candidate,event,effect.target),player=tx.draft.players.find(item=>item.seat===seat)!,amount=Math.max(0,Math.floor(Number(params.amount)));if(!Number.isFinite(amount))throw new Error("TRIGGER_AMOUNT_INVALID");if(player.lifeState==="eliminated"||player.lifeState==="deadNotEliminated")return;
    if(op==="recoverHp"){if(player.hp===null||player.maxHp===null)return;const before=player.hp;player.hp=Math.min(player.maxHp,player.hp+amount);tx.emit("health.recovered",{seat,amount:player.hp-before,sourceRef:candidate.sourceRef,triggerId:candidate.triggerId});}
    else{if(player.shield===null||player.maxShield===null)return;const before=player.shield;player.shield=Math.min(player.maxShield,player.shield+amount);tx.emit("shield.recovered",{seat,amount:player.shield-before,sourceRef:candidate.sourceRef,triggerId:candidate.triggerId});}
  }
  else if(op==="drawCards"){const seat=targetSeat(tx.draft,candidate,event,effect.target),count=Math.max(0,Math.floor(Number(params.count)));if(!Number.isFinite(count))throw new Error("TRIGGER_COUNT_INVALID");drawCardsInTransaction(tx,seat,count,`trigger:${candidate.triggerId}`);}
  else if(op==="createDamage")scheduleDamage(tx,candidate,event,effect);
  else if(op==="applyStatus"){const seat=targetSeat(tx.draft,candidate,event,effect.target);applyStatusInTransaction(tx,ruleset,{ownerSeat:seat,statusId:String(params.statusId),sourceRef:candidate.sourceRef,metadata:{triggerId:candidate.triggerId}});}
  else if(op==="addMarker"||op==="modifyMarker"){
    const seat=targetSeat(tx.draft,candidate,event,effect.target??"$controller"),player=tx.draft.players.find(item=>item.seat===seat)!,markerId=String(params.markerId),before=typeof player.markers[markerId]==="number"?player.markers[markerId] as number:0,delta=op==="addMarker"?Number(params.amount??1):Number(params.delta);if(!Number.isFinite(delta))throw new Error("TRIGGER_MARKER_DELTA_INVALID");player.markers[markerId]=before+delta;tx.emit("marker.changed",{seat,markerId,from:before,to:before+delta,triggerId:candidate.triggerId});
  }
  else if(op==="consumeLimit"){
    const scope=String(params.scope??""),attack=tx.draft.combat.attack&&typeof tx.draft.combat.attack==="object"&&!Array.isArray(tx.draft.combat.attack)?tx.draft.combat.attack as EffectRecord:null;
    if(scope==="perTargetPerAttack"){
      if(!attack)throw new Error("TRIGGER_ATTACK_SCOPE_UNAVAILABLE");
      const attackId=String(event.payload.attackId??attack.attackId),targetRef=String(event.payload.targetRef),usageKey=`${candidate.triggerId}:${candidate.sourceRef}:${attackId}:${targetRef}`,used=Array.isArray(attack.triggerUsageKeys)?attack.triggerUsageKeys as JsonValue[]:[];
      if(used.includes(usageKey))throw new Error("TRIGGER_LIMIT_UNAVAILABLE");
      attack.triggerUsageKeys=[...used,usageKey];
      tx.emit("limit.consumed",{seat:candidate.controllerSeat,scope,attackId,targetRef,usageKey,triggerId:candidate.triggerId});
    }else if(scope==="perEquippedInstance"){
      if(candidate.sourceKind==="card"){const card=tx.draft.cards[candidate.sourceRef];if(!card||card.runtime.triggerLimitConsumed===true)throw new Error("TRIGGER_LIMIT_UNAVAILABLE");card.runtime.triggerLimitConsumed=true;}
      else{const player=tx.draft.players.find(item=>item.seat===candidate.controllerSeat)!,limitId=`${candidate.familyId}.perInstanceConsumed`;if(player.limits[limitId]===true)throw new Error("TRIGGER_LIMIT_UNAVAILABLE");player.limits[limitId]=true;}
      tx.emit("limit.consumed",{seat:candidate.controllerSeat,scope,sourceRef:candidate.sourceRef,triggerId:candidate.triggerId});
    }else{
      const player=tx.draft.players.find(item=>item.seat===candidate.controllerSeat)!,limitId=String(params.limit??params.scope??candidate.triggerId),before=typeof player.limits[limitId]==="number"?player.limits[limitId] as number:1;if(before<=0)throw new Error("TRIGGER_LIMIT_UNAVAILABLE");player.limits[limitId]=before-1;tx.emit("limit.consumed",{seat:candidate.controllerSeat,limitId,from:before,to:before-1,triggerId:candidate.triggerId});
    }
  }
  else if(op==="scheduleEffect"){
    const scheduledId=`scheduled:trigger:${candidate.triggerId}:${tx.draft.stateRevision+1}:${tx.draft.scheduledEffects.length}`,dyingRef=typeof event.payload.dyingRef==="string"?event.payload.dyingRef:typeof event.payload.targetRef==="string"?event.payload.targetRef:null,point=String(params.point);tx.draft.scheduledEffects.push({scheduledId,sourceRef:candidate.sourceRef,controllerSeat:candidate.controllerSeat,executeAt:dyingRef?`${point}:${dyingRef}`:point,effect:{op:"scheduledTrigger",triggerId:candidate.triggerId,familyId:candidate.familyId,eventPayload:event.payload,params},cancelled:false});tx.emit("effect.scheduled",{scheduledId,triggerId:candidate.triggerId,sourceRef:candidate.sourceRef,point,dyingRef});
  }
  else if(op==="sequence"){const effects=Array.isArray(effect.effects)?effect.effects:Array.isArray(params.effects)?params.effects:[];for(const child of effects)executeOne(tx,ruleset,candidate,event,child);}
  else throw new Error(`TRIGGER_EFFECT_UNSUPPORTED:${op}`);
}
export function executeMatchedTriggerInTransaction(tx:EngineTransaction<AuthoritativeGameState>,ruleset:LoadedRuleset,candidate:MatchedTriggerCandidate,event:TriggerEventFact,options:{allowOptional?:boolean;eventKey?:string}={}):void{
  if(candidate.optional&&!options.allowOptional)throw new Error("TRIGGER_OPTIONAL_REQUIRES_WINDOW");
  const current=matchTriggeredEffects(tx.draft,[candidate],event).find(item=>item.triggerId===candidate.triggerId&&item.sourceRef===candidate.sourceRef);if(!current)throw new Error("TRIGGER_NO_LONGER_MATCHES");
  tx.emit("trigger.execution.before",{triggerId:candidate.triggerId,sourceRef:candidate.sourceRef,controllerSeat:candidate.controllerSeat,eventType:event.eventType,eventKey:options.eventKey??null});for(const effect of candidate.effects)executeOne(tx,ruleset,candidate,event,effect);tx.emit("trigger.resolved",{triggerId:candidate.triggerId,sourceRef:candidate.sourceRef,controllerSeat:candidate.controllerSeat,eventType:event.eventType,eventKey:options.eventKey??null});
}
export function executeMatchedTrigger(state:AuthoritativeGameState,ruleset:LoadedRuleset,candidate:MatchedTriggerCandidate,event:TriggerEventFact,options:{allowOptional?:boolean;closePromptId?:string;eventKey?:string}={}):TransactionCommit<AuthoritativeGameState>{
  const tx=new EngineTransaction(state);if(options.closePromptId)tx.draft.pendingWindows=tx.draft.pendingWindows.filter(window=>window.promptId!==options.closePromptId);executeMatchedTriggerInTransaction(tx,ruleset,candidate,event,options);const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);return committed;
}
