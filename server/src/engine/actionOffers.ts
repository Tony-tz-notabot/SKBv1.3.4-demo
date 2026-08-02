import type {ActionDefinition} from "./actions.js";
import type {CardCostSpec,CostSpec} from "./costs.js";
import {handCards,type AuthoritativeGameState,type Seat} from "./state.js";
import {calculateTargetOffer,type TargetOffer} from "./targets.js";

export interface CardCostOffer {costId:string;kind:"cards";count:number;legalCardRefs:string[];moveKind:CardCostSpec["moveKind"]}
export interface FixedCostOffer {costId:string;kind:"value"|"limit";amount:number;payable:boolean}
export type CostOffer=CardCostOffer|FixedCostOffer;
export interface ActionOffer {offerId:string;actionId:string;kind:string;actorSeat:Seat;stateRevision:number;targetOffers:Record<string,TargetOffer>;costOffers:CostOffer[];payable:boolean}

function costOffer(state:AuthoritativeGameState,seat:Seat,spec:CostSpec):CostOffer{const player=state.players.find(item=>item.seat===seat)!;if(spec.kind==="cards"){const legalCardRefs=handCards(state,seat).filter(ref=>!spec.templateIds||spec.templateIds.includes(state.cards[ref]!.templateId));return{costId:spec.costId,kind:"cards",count:spec.count,legalCardRefs,moveKind:spec.moveKind};}if(spec.kind==="value"){const value=player[spec.resource];return{costId:spec.costId,kind:"value",amount:spec.amount,payable:value!==null&&value-spec.amount>=spec.minimumAfterPayment};}const value=player.limits[spec.limitId];return{costId:spec.costId,kind:"limit",amount:spec.amount,payable:typeof value==="number"&&value>=spec.amount};}
export function buildActionOffer(state:AuthoritativeGameState,actorSeat:Seat,offerId:string,definition:ActionDefinition):ActionOffer{const targetOffers=Object.fromEntries(definition.targetGroups.map(group=>[group.key,calculateTargetOffer(state,actorSeat,group.spec)]));const costOffers=definition.costs.map(spec=>costOffer(state,actorSeat,spec));const payable=costOffers.every(offer=>offer.kind==="cards"?offer.legalCardRefs.length>=offer.count:offer.payable)&&Object.values(targetOffers).every(offer=>offer.legalTargetRefs.length>=offer.spec.min);return{offerId,actionId:definition.actionId,kind:definition.kind,actorSeat,stateRevision:state.stateRevision,targetOffers,costOffers,payable};}
