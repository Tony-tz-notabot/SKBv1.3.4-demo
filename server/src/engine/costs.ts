import {handZoneRef,type AuthoritativeGameState,type Seat} from "./state.js";
import {EngineTransaction} from "./transaction.js";

export interface CardCostSpec {costId:string;kind:"cards";count:number;from:"hand";templateIds?:string[];moveKind:"discard"|"synthesizeConsume"}
export interface ValueCostSpec {costId:string;kind:"value";resource:"hp"|"shield"|"ironShield";amount:number;minimumAfterPayment:number}
export interface LimitCostSpec {costId:string;kind:"limit";limitId:string;amount:number}
export type CostSpec=CardCostSpec|ValueCostSpec|LimitCostSpec;
export interface CostSelections {cardRefsByCostId:Record<string,string[]>}
export interface CostPlan {specs:CostSpec[];selections:CostSelections}

const integerNonnegative=(value:number)=>Number.isInteger(value)&&value>=0;
export function validateCostPlan(state:AuthoritativeGameState,seat:Seat,plan:CostPlan):void{
  const player=state.players.find(item=>item.seat===seat);if(!player)throw new Error("PLAYER_NOT_FOUND");const allCards:string[]=[];
  for(const spec of plan.specs){const numericAmount=spec.kind==="cards"?spec.count:spec.amount;if(!integerNonnegative(numericAmount))throw new Error("COST_AMOUNT_INVALID");if(spec.kind==="cards"){const refs=plan.selections.cardRefsByCostId[spec.costId]??[];if(refs.length!==spec.count||new Set(refs).size!==refs.length)throw new Error("COST_SELECTION_INVALID");for(const ref of refs){const card=state.cards[ref];if(!card||card.zoneRef!==handZoneRef(seat)||spec.templateIds&&!spec.templateIds.includes(card.templateId))throw new Error("COST_UNPAYABLE");allCards.push(ref);}}else if(spec.kind==="value"){const value=player[spec.resource];if(value===null||value-spec.amount<spec.minimumAfterPayment)throw new Error("COST_UNPAYABLE");}else{const value=player.limits[spec.limitId];if(typeof value!=="number"||value<spec.amount)throw new Error("COST_UNPAYABLE");}}
  if(new Set(allCards).size!==allCards.length)throw new Error("COST_CARD_REUSED");
}

export function payCostPlan(tx:EngineTransaction<AuthoritativeGameState>,seat:Seat,plan:CostPlan):void{
  validateCostPlan(tx.draft,seat,plan);const draft=tx.draft,player=draft.players.find(item=>item.seat===seat)!;
  for(const spec of plan.specs){if(spec.kind==="cards"){for(const cardRef of plan.selections.cardRefsByCostId[spec.costId]??[]){const hand=draft.zones[handZoneRef(seat)]!,index=hand.orderedCardRefs.indexOf(cardRef);hand.orderedCardRefs.splice(index,1);draft.zones.discardPile!.orderedCardRefs.push(cardRef);const card=draft.cards[cardRef]!;card.zoneRef="discardPile";card.ownerSeat=null;card.controllerSeat=null;card.faceUp=true;tx.emit("cost.paid",{seat,costId:spec.costId,kind:spec.kind,cardRef,moveKind:spec.moveKind});}}else if(spec.kind==="value"){const before=player[spec.resource] as number;player[spec.resource]=before-spec.amount;tx.emit("cost.paid",{seat,costId:spec.costId,kind:spec.kind,resource:spec.resource,amount:spec.amount});}else{const before=player.limits[spec.limitId] as number;player.limits[spec.limitId]=before-spec.amount;tx.emit("limit.consumed",{seat,costId:spec.costId,limitId:spec.limitId,amount:spec.amount});}}
}
