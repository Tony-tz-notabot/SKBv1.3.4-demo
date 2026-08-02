import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState} from "./state.js";
import {validateAuthoritativeState} from "./stateValidation.js";
import {EngineTransaction} from "./transaction.js";
import type {JsonValue,TransactionCommit} from "./types.js";

type AttackRecord=Record<string,JsonValue>;
interface WeaponTemplate {weaponId:string;judgments?:unknown[]}
const record=(value:JsonValue|null,code:string):AttackRecord=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(code);return value as AttackRecord;};

export function applyAttackCriticalModifier(state:AuthoritativeGameState,ruleset:LoadedRuleset):TransactionCommit<AuthoritativeGameState>|null{
  const raw=state.combat.attack;if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;const attack=raw as AttackRecord;if(attack.critical!==true||attack.criticalSegmentsAdjusted===true)return null;
  const weaponId=typeof attack.weaponId==="string"?attack.weaponId:null,document=ruleset.documents.get("weapon-rules.json") as {templates:WeaponTemplate[]},weapon=weaponId?document.templates.find(item=>item.weaponId===weaponId):null;
  if(weapon?.judgments?.length)return null;
  const tx=new EngineTransaction(state),draftAttack=record(tx.draft.combat.attack,"ATTACK_CONTEXT_MISSING"),segments=Array.isArray(draftAttack.damageSegments)?draftAttack.damageSegments:[];
  for(const rawSegment of segments){if(!rawSegment||typeof rawSegment!=="object"||Array.isArray(rawSegment))throw new Error("DAMAGE_SEGMENT_INVALID");const segment=rawSegment as AttackRecord;if(segment.isAdditional===true)continue;const before=Number(segment.amount);if(!Number.isFinite(before)||before<0)throw new Error("DAMAGE_AMOUNT_INVALID");segment.amount=before+1;tx.emit("damage.modified",{attackId:String(draftAttack.attackId),segmentId:String(segment.segmentId),from:before,to:before+1,reason:"criticalNonAdditionalSegment"});}
  draftAttack.criticalSegmentsAdjusted=true;tx.emit("critical.applied",{attackId:String(draftAttack.attackId),mode:"nonJudgmentWeapon",amountPerNonAdditionalSegment:1});const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);return committed;
}
