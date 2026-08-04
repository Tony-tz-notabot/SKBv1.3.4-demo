import type { AuthoritativeGameState, Seat } from "./state.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

const player=(s:AuthoritativeGameState,n:Seat)=>s.players.find(x=>x.seat===n)!;
const canAct=(s:AuthoritativeGameState,n:Seat)=>s.activeSeat===n&&s.phase==="play"&&s.phaseBoundary==="body"&&!s.combat.attack&&s.pendingWindows.some(x=>x.kind==="playPhaseAction"&&x.prioritySeat===n);

export function buildArmorEquipOffers(s:AuthoritativeGameState,r:LoadedRuleset,n:Seat){
  if(!canAct(s,n))return[];
  const toZoneRef=`armor:${n}`;
  return (s.zones[`hand:${n}`]?.orderedCardRefs??[]).filter(cardRef=>s.cards[cardRef]!.templateId.startsWith("armor.")).map(cardRef=>({offerId:`offer:armor-equip:${cardRef}`,cardRef,toZoneRef,replacedCardRef:s.zones[toZoneRef]!.orderedCardRefs[0]??null}));
}
type Command={commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;cardRef:string};
type Result={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
export class ArmorEquipSession {
  #state:AuthoritativeGameState;#results=new Map<string,Result>();
  constructor(s:AuthoritativeGameState,private r:LoadedRuleset){this.#state=s}
  get state(){return this.#state}
  handle(c:Command):Result{
    const old=this.#results.get(c.commandId);if(old)return structuredClone(old);
    const reject=(reasonCode:string,refreshRequired:boolean):Result=>({accepted:false,commandId:c.commandId,stateRevision:this.#state.stateRevision,reasonCode,refreshRequired});
    if(c.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);
    if(c.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);
    const p=this.#state.players.find(x=>x.userId===c.actorUserId),w=p?this.#state.pendingWindows.find(x=>x.promptId===c.promptId&&x.prioritySeat===p.seat):undefined,o=p?buildArmorEquipOffers(this.#state,this.r,p.seat).find(x=>x.offerId===c.offerId&&x.cardRef===c.cardRef):undefined;
    if(!p||!w)return reject("NOT_YOUR_PRIORITY",false);
    if(!o)return reject("OFFER_EXPIRED",true);
    const tx=new EngineTransaction(this.#state);
    if(o.replacedCardRef)moveCardInTransaction(tx,{cardRef:o.replacedCardRef,toZoneRef:"discardPile",moveKind:"replace",faceUp:true});
    moveCardInTransaction(tx,{cardRef:c.cardRef,toZoneRef:o.toZoneRef,moveKind:"equip",faceUp:true});
    tx.emit("card.equipped",{seat:p.seat,cardRef:c.cardRef,cardId:tx.draft.cards[c.cardRef]!.templateId,zoneRef:o.toZoneRef,replacedCardRef:o.replacedCardRef});
    const out=tx.commit();out.state.history.domainEvents.push(...out.events);validateAuthoritativeState(out.state);this.#state=out.state;
    const result:Result={accepted:true,commandId:c.commandId,previousRevision:out.previousRevision,stateRevision:out.state.stateRevision,events:out.events};
    this.#results.set(c.commandId,result);return structuredClone(result);
  }
}
