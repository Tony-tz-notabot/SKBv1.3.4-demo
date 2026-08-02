import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
interface Contribution extends Record<string, JsonValue> { maxHp:number; maxShield:number; handLimit:number }
const empty=():Contribution=>({maxHp:0,maxShield:0,handLimit:0});
export function resolveTalentContribution(r:LoadedRuleset,id:string):Contribution{
  const doc=r.documents.get("nonboss-rules.json") as {effectFamilies:Array<Record<string,unknown>>},family=doc.effectFamilies.find(x=>x.familyId===id),result=empty();
  for(const raw of(family?.onEquip as Array<Record<string,unknown>>|undefined)??[]){const params=raw.params as Record<string,unknown>|undefined,delta=Number(params?.delta??0);if(raw.op==="changeMaxHp")result.maxHp+=delta;if(raw.op==="changeMaxShield")result.maxShield+=delta}
  for(const raw of(family?.modifiers as Array<Record<string,unknown>>|undefined)??[]){const op=raw.operation as Record<string,unknown>|undefined;if(raw.query==="hand.limit")result.handLimit+=Number(op?.add??0)}
  return result;
}
const read=(value:JsonValue|undefined):Contribution=>{if(!value||typeof value!=="object"||Array.isArray(value))return empty();const x=value as Record<string,JsonValue>;return{maxHp:Number(x.maxHp??0),maxShield:Number(x.maxShield??0),handLimit:Number(x.handLimit??0)}};
export function applyTalentEquipContribution(tx:EngineTransaction<AuthoritativeGameState>,seat:Seat,id:string,direction:1|-1,snapshot:JsonValue|Contribution|undefined):boolean{
  const c=read(snapshot as JsonValue);if(!c.maxHp&&!c.maxShield&&!c.handLimit)return false;const p=tx.draft.players.find(x=>x.seat===seat)!;
  if(c.maxHp&&p.maxHp!==null&&p.hp!==null){p.maxHp+=c.maxHp*direction;if(direction>0)p.hp+=c.maxHp;else p.hp=Math.min(p.hp,p.maxHp)}
  if(c.maxShield&&p.maxShield!==null&&p.shield!==null){p.maxShield+=c.maxShield*direction;if(direction>0)p.shield+=c.maxShield;else p.shield=Math.min(p.shield,p.maxShield)}
  if(c.handLimit){p.markers["talent.handLimitContribution"]=Math.max(0,Number(p.markers["talent.handLimitContribution"]??0)+c.handLimit*direction);if(!p.markers["talent.handLimitContribution"])delete p.markers["talent.handLimitContribution"]}
  tx.emit("talent.contribution.changed",{seat,talentId:id,direction,contribution:c,maxHp:p.maxHp,maxShield:p.maxShield});return true;
}
export function setEquippedTalentContributionsEnabled(tx:EngineTransaction<AuthoritativeGameState>,seat:Seat,enabled:boolean){
  for(const ref of tx.draft.zones[`talent:${seat}`]?.orderedCardRefs??[]){const card=tx.draft.cards[ref]!,active=card.runtime.talentContributionActive===true,snapshot=card.runtime.talentContribution;if(enabled&&!active)card.runtime.talentContributionActive=applyTalentEquipContribution(tx,seat,card.templateId,1,snapshot);else if(!enabled&&active){applyTalentEquipContribution(tx,seat,card.templateId,-1,snapshot);card.runtime.talentContributionActive=false}}
}
