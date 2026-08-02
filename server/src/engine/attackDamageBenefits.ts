import type { LoadedRuleset } from "../ruleset/types.js";
import { executeMatchedTriggerInTransaction } from "./triggerEffects.js";
import { compileTriggerRegistry, matchTriggeredEffects, type TriggerEventFact } from "./triggerRegistry.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";

const BENEFIT_FAMILIES=new Set(["talent.life_steal","talent.mana_siphon"]);
type AttackRecord=Record<string,JsonValue>;

export function applyAttackTargetHpLossBenefits(tx:EngineTransaction<AuthoritativeGameState>,ruleset:LoadedRuleset,attack:AttackRecord,targetRef:string,actualHpLoss:number):void{
  if(actualHpLoss<2)return;
  const attackId=String(attack.attackId),attackerSeat=Number(attack.attackerSeat),event:TriggerEventFact={eventType:"damage.applied",payload:{attackId,attackerSeat,sourceSeat:attackerSeat,targetRef,actualHpLoss,aggregateActualHpLoss:actualHpLoss,aggregateScope:"perTargetPerAttack"}};
  const definitions=compileTriggerRegistry(ruleset).filter(item=>BENEFIT_FAMILIES.has(item.familyId));
  const used=Array.isArray(attack.triggerUsageKeys)?attack.triggerUsageKeys:[];
  for(const candidate of matchTriggeredEffects(tx.draft,definitions,event)){
    const usageKey=`${candidate.triggerId}:${candidate.sourceRef}:${attackId}:${targetRef}`;
    if(used.includes(usageKey))continue;
    executeMatchedTriggerInTransaction(tx,ruleset,candidate,event,{eventKey:`${attackId}:${targetRef}:actualHpLoss`});
  }
}
