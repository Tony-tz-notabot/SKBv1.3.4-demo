import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { applyStatusInTransaction } from "./status.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { DomainEvent, JsonValue } from "./types.js";

const CHARACTER="character.ancient_elementalist", ABILITY="skill.ancient_elementalist.element_satchel";
export type SatchelMode="frozen"|"electrified"|"flame";
interface RuleEffect { op:string; choice?:{max?:number} }
function flameMaximum(r:LoadedRuleset) {
  const doc=r.documents.get("character-rules.json") as {rules:Array<{ruleId:string;effects:RuleEffect[]}>},
    rule=doc.rules.find((x)=>x.ruleId==="character.elementalist.flameSatchel"), select=rule?.effects.find((x)=>x.op==="selectCards");
  const value=Number(select?.choice?.max); if(!Number.isInteger(value)||value<1) throw new Error("ELEMENT_SATCHEL_RULE_INVALID"); return value;
}
const playWindow=(s:AuthoritativeGameState,seat:Seat)=>s.pendingWindows.find((w)=>w.kind==="playPhaseAction"&&w.prioritySeat===seat);
const turnKey=(s:AuthoritativeGameState)=>`${s.round}:${s.activeSeat}:${[...s.history.domainEvents].reverse().find((e)=>e.eventType==="turn.start")?.eventSeq??0}`;
export function dismantlableCards(s:AuthoritativeGameState,r:LoadedRuleset,seat:Seat) {
  return Object.values(s.zones).filter((z)=>z.ownerSeat===seat && !["outsideDeck","removedFromGame","resolving"].includes(z.zoneType) &&
    (z.zoneType!=="bossSlot"||r.settings.boss.allowGenericDismantle)).flatMap((z)=>z.orderedCardRefs);
}
export interface ElementSatchelOffer {offerId:string;mode:SatchelMode;targetRef:string;requiredCardCount:number;legalCardRefs:string[];stateRevision:number}
export function buildElementSatchelOffers(s:AuthoritativeGameState,r:LoadedRuleset,seat:Seat):ElementSatchelOffer[] {
  const p=s.players.find((x)=>x.seat===seat),w=playWindow(s,seat);
  if(!p||p.characterId!==CHARACTER||!p.skillIds.includes(ABILITY)||p.lifeState!=="alive"||p.presence!=="inPlay"||s.activeSeat!==seat||s.phase!=="play"||s.phaseBoundary!=="body"||!w||s.combat.attack||p.markers["elementSatchel.usedTurn"]===turnKey(s))return[];
  const out:ElementSatchelOffer[]=[];
  for(const target of s.players.filter((x)=>x.presence==="inPlay"&&x.lifeState!=="eliminated")) {
    for(const mode of ["frozen","electrified","flame"] as const) {
      if(p.markers[`elementSatchel.used.${mode}`]===true)continue;
      const legal=mode==="flame"?dismantlableCards(s,r,target.seat):[], required=mode==="flame"?Math.min(flameMaximum(r),legal.length):0;
      if(mode==="flame"&&required===0)continue;
      out.push({offerId:`offer:${ABILITY}:${mode}:${target.seat}`,mode,targetRef:`character:${target.seat}`,requiredCardCount:required,legalCardRefs:legal,stateRevision:s.stateRevision});
    }
  }
  return out;
}
export interface ElementSatchelCommand {commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;targetRef:string;cardRefs:string[]}
type Result={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
export class ElementSatchelSession {
  #state:AuthoritativeGameState;#results=new Map<string,Result>();constructor(state:AuthoritativeGameState,private r:LoadedRuleset){this.#state=state}get state(){return this.#state}
  handle(c:ElementSatchelCommand):Result {const prior=this.#results.get(c.commandId);if(prior)return structuredClone(prior);const reject=(reasonCode:string,refreshRequired:boolean):Result=>{const x={accepted:false as const,commandId:c.commandId,stateRevision:this.#state.stateRevision,reasonCode,refreshRequired};this.#results.set(c.commandId,x);return structuredClone(x)};
    if(c.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);if(c.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);
    const actor=this.#state.players.find((x)=>x.userId===c.actorUserId),w=actor?playWindow(this.#state,actor.seat):undefined;if(!actor||!w)return reject("NOT_YOUR_PRIORITY",false);if(w.promptId!==c.promptId)return reject("PROMPT_CLOSED",true);
    const offer=buildElementSatchelOffers(this.#state,this.r,actor.seat).find((x)=>x.offerId===c.offerId&&x.targetRef===c.targetRef);if(!offer)return reject("OFFER_EXPIRED",true);
    if(c.cardRefs.length!==offer.requiredCardCount||new Set(c.cardRefs).size!==c.cardRefs.length)return reject("SELECTION_COUNT_INVALID",false);if(!c.cardRefs.every((x)=>offer.legalCardRefs.includes(x)))return reject("CARD_NO_LONGER_LEGAL",true);
    const tx=new EngineTransaction(this.#state),p=tx.draft.players.find((x)=>x.seat===actor.seat)!,targetSeat=Number(c.targetRef.split(":")[1]) as Seat;
    if(offer.mode==="flame")for(const ref of c.cardRefs){moveCardInTransaction(tx,{cardRef:ref,toZoneRef:"discardPile",moveKind:"dismantle",faceUp:true});tx.emit("card.dismantled",{cardRef:ref,sourceSeat:actor.seat,targetSeat,sourceRef:ABILITY});}
    else applyStatusInTransaction(tx,this.r,{ownerSeat:targetSeat,statusId:offer.mode==="frozen"?"status.frozen":"status.electrified",sourceRef:`character:${actor.seat}`,metadata:{abilityId:ABILITY}});
    p.markers[`elementSatchel.used.${offer.mode}`]=true;p.markers["elementSatchel.usedTurn"]=turnKey(tx.draft);
    tx.emit("ability.activation.committed",{seat:actor.seat,abilityId:ABILITY,mode:offer.mode,targetRef:c.targetRef,cardRefs:c.cardRefs as unknown as JsonValue});
    const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);this.#state=committed.state;const result={accepted:true as const,commandId:c.commandId,previousRevision:committed.previousRevision,stateRevision:committed.state.stateRevision,events:committed.events};this.#results.set(c.commandId,result);return structuredClone(result);
  }
}
