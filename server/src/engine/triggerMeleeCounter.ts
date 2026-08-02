import type { LoadedRuleset } from "../ruleset/types.js";
import { compileTriggerRegistry, matchTriggeredEffects, type TriggerEventFact } from "./triggerRegistry.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";

type AttackRecord=Record<string,JsonValue>;
const family="talent.melee_counter";
const attackRecord=(value:JsonValue|null):AttackRecord=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("ATTACK_CONTEXT_MISSING");return value as AttackRecord;};

export function processMeleeCounterResponseEvents(committed:TransactionCommit<AuthoritativeGameState>,ruleset:LoadedRuleset):TransactionCommit<AuthoritativeGameState>{
  let state=committed.state;const events=[...committed.events],definitions=compileTriggerRegistry(ruleset).filter(item=>item.familyId===family);
  for(const domainEvent of committed.events){if(domainEvent.eventType!=="response.resolved")continue;const payload=domainEvent.payload&&typeof domainEvent.payload==="object"&&!Array.isArray(domainEvent.payload)?domainEvent.payload as Record<string,JsonValue>:{};const fact:TriggerEventFact={eventType:"response.resolved",payload};
    for(const candidate of matchTriggeredEffects(state,definitions,fact)){
      const parent=attackRecord(state.combat.attack),depth=Number(parent.chainDepth??0);if(depth>=10)continue;
      const sourceSeat=Number(parent.attackerSeat) as Seat,reflected=structuredClone(parent);
      for(const key of ["currentTargetHit","currentTargetResult","currentTargetMissReason","currentTargetDamage","pendingJudgmentEffects","judgmentResults","afterAttackQueue","continuationQueue","resumePlayDeadlineAt","triggerUsageKeys"])delete reflected[key];
      reflected.attackId=`attack:reflection:${String(parent.attackId)}:${depth+1}`;reflected.attackerSeat=candidate.controllerSeat;reflected.targetRefs=[`character:${sourceSeat}`];reflected.killCardRefs=[];reflected.status="committed";reflected.chainDepth=depth+1;reflected.generatedByAttackId=String(parent.attackId);reflected.reflectedBySeat=candidate.controllerSeat;
      const tx=new EngineTransaction(state),draftParent=attackRecord(tx.draft.combat.attack),queue=Array.isArray(draftParent.afterAttackQueue)?draftParent.afterAttackQueue:[];draftParent.afterAttackQueue=[...queue,reflected];
      tx.emit("trigger.execution.before",{triggerId:candidate.triggerId,sourceRef:candidate.sourceRef,controllerSeat:candidate.controllerSeat,eventType:fact.eventType,eventKey:`event:${domainEvent.eventSeq}`});
      tx.emit("attack.queued",{attackId:String(reflected.attackId),parentAttackId:String(parent.attackId),kind:"meleeCounter",reflectorSeat:candidate.controllerSeat,chainDepth:depth+1});
      tx.emit("trigger.resolved",{triggerId:candidate.triggerId,sourceRef:candidate.sourceRef,controllerSeat:candidate.controllerSeat,eventType:fact.eventType,eventKey:`event:${domainEvent.eventSeq}`});
      const next=tx.commit();next.state.history.domainEvents.push(...next.events);validateAuthoritativeState(next.state);state=next.state;events.push(...next.events);
    }
  }
  return {previousRevision:committed.previousRevision,state,events};
}
