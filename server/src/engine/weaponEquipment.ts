import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

interface WeaponTemplate { weaponId:string; slotType:string; durability?:{baseMax:number}; cooldown?:{printedCd:number} }
const document=(r:LoadedRuleset)=>r.documents.get("weapon-rules.json") as {templates:WeaponTemplate[]};
const player=(s:AuthoritativeGameState,n:Seat)=>s.players.find(x=>x.seat===n)!;
const enabled=(s:AuthoritativeGameState,n:Seat)=>{const p=player(s,n);return p.markers.equipmentEffectsDisabled!==true&&!p.statuses.some(x=>x.statusId==="status.equipmentDisabled")};
const hasTriple=(s:AuthoritativeGameState,n:Seat)=>player(s,n).initialTalentIds.includes("talent.triple_wield")||(enabled(s,n)&&(s.zones[`talent:${n}`]?.orderedCardRefs??[]).some(ref=>s.cards[ref]?.templateId==="talent.triple_wield"));
const regularSlots=(s:AuthoritativeGameState,n:Seat)=>[`weapon:1:${n}`,`weapon:2:${n}`,...(hasTriple(s,n)?[`weapon:3:${n}`]:[])];
const canAct=(s:AuthoritativeGameState,n:Seat)=>s.activeSeat===n&&s.phase==="play"&&s.phaseBoundary==="body"&&!s.combat.attack&&s.pendingWindows.some(x=>x.kind==="playPhaseAction"&&x.prioritySeat===n);

export function buildWeaponEquipOffers(s:AuthoritativeGameState,r:LoadedRuleset,n:Seat){
  if(!canAct(s,n))return [];
  const templates=new Map(document(r).templates.map(x=>[x.weaponId,x]));
  return (s.zones[`hand:${n}`]?.orderedCardRefs??[]).flatMap(cardRef=>{
    const template=templates.get(s.cards[cardRef]!.templateId);if(!template)return [];
    const slots=template.slotType==="thirdWeapon"?[`thirdWeapon:${n}`]:regularSlots(s,n);
    return slots.map(toZoneRef=>({offerId:`offer:weapon-equip:${cardRef}:${toZoneRef}`,cardRef,toZoneRef,replacedCardRef:s.zones[toZoneRef]!.orderedCardRefs[0]??null}));
  });
}
export function buildWeaponDiscardOffers(s:AuthoritativeGameState,n:Seat){
  if(!canAct(s,n))return [];
  return [...regularSlots(s,n),`weapon:3:${n}`,`thirdWeapon:${n}`].filter((x,i,a)=>a.indexOf(x)===i).flatMap(zoneRef=>(s.zones[zoneRef]?.orderedCardRefs??[]).map(cardRef=>({offerId:`offer:weapon-discard:${cardRef}`,cardRef,zoneRef})));
}
type Command={commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;cardRef:string};
type Result={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
abstract class Session {
  protected current:AuthoritativeGameState;protected results=new Map<string,Result>();
  constructor(s:AuthoritativeGameState){this.current=s} get state(){return this.current}
  protected reject(c:Command,reasonCode:string,refreshRequired:boolean):Result{return{accepted:false,commandId:c.commandId,stateRevision:this.current.stateRevision,reasonCode,refreshRequired}}
  protected actor(c:Command){return this.current.players.find(x=>x.userId===c.actorUserId)}
  protected finish(c:Command,tx:EngineTransaction<AuthoritativeGameState>):Result{const out=tx.commit();out.state.history.domainEvents.push(...out.events);validateAuthoritativeState(out.state);this.current=out.state;const result:Result={accepted:true,commandId:c.commandId,previousRevision:out.previousRevision,stateRevision:out.state.stateRevision,events:out.events};this.results.set(c.commandId,result);return structuredClone(result)}
  protected precheck(c:Command){const old=this.results.get(c.commandId);if(old)return structuredClone(old);if(c.gameId!==this.current.gameId)return this.reject(c,"GAME_NOT_FOUND",false);if(c.expectedStateRevision!==this.current.stateRevision)return this.reject(c,"STALE_REVISION",true);return null}
}
export class WeaponEquipSession extends Session {
  constructor(s:AuthoritativeGameState,private ruleset:LoadedRuleset){super(s)}
  handle(c:Command):Result{const checked=this.precheck(c);if(checked)return checked;const actor=this.actor(c),window=actor?this.current.pendingWindows.find(x=>x.promptId===c.promptId&&x.prioritySeat===actor.seat):undefined,offer=actor?buildWeaponEquipOffers(this.current,this.ruleset,actor.seat).find(x=>x.offerId===c.offerId&&x.cardRef===c.cardRef):undefined;if(!actor||!window)return this.reject(c,"NOT_YOUR_PRIORITY",false);if(!offer)return this.reject(c,"OFFER_EXPIRED",true);
    const tx=new EngineTransaction(this.current);if(offer.replacedCardRef)moveCardInTransaction(tx,{cardRef:offer.replacedCardRef,toZoneRef:"discardPile",moveKind:"replace",faceUp:true});moveCardInTransaction(tx,{cardRef:c.cardRef,toZoneRef:offer.toZoneRef,moveKind:"equip",faceUp:true});const card=tx.draft.cards[c.cardRef]!,template=document(this.ruleset).templates.find(x=>x.weaponId===card.templateId);if(template?.durability){const scatter=actor.initialTalentIds.includes("talent.scatter_up")&&enabled(tx.draft,actor.seat)?1:0;card.runtime.durabilityMax=template.durability.baseMax+scatter;card.runtime.durabilityCurrent=template.durability.baseMax+scatter;}if(template?.cooldown)card.runtime.cooldownRemaining=0;tx.emit("card.equipped",{seat:actor.seat,cardRef:c.cardRef,cardId:card.templateId,zoneRef:offer.toZoneRef,replacedCardRef:offer.replacedCardRef});return this.finish(c,tx);
  }
}
export class WeaponDiscardSession extends Session {
  handle(c:Command):Result{const checked=this.precheck(c);if(checked)return checked;const actor=this.actor(c),window=actor?this.current.pendingWindows.find(x=>x.promptId===c.promptId&&x.prioritySeat===actor.seat):undefined,offer=actor?buildWeaponDiscardOffers(this.current,actor.seat).find(x=>x.offerId===c.offerId&&x.cardRef===c.cardRef):undefined;if(!actor||!window)return this.reject(c,"NOT_YOUR_PRIORITY",false);if(!offer)return this.reject(c,"OFFER_EXPIRED",true);const tx=new EngineTransaction(this.current);moveCardInTransaction(tx,{cardRef:c.cardRef,toZoneRef:"discardPile",moveKind:"discard",faceUp:true});tx.emit("card.discarded",{seat:actor.seat,cardRef:c.cardRef,cardId:tx.draft.cards[c.cardRef]!.templateId,fromZoneRef:offer.zoneRef});return this.finish(c,tx)}
}
