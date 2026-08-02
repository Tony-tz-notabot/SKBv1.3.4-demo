import type {AuthoritativeGameState,Seat,ZoneType} from "./state.js";

import {calculateEffectiveDistance} from "./distance.js";
export interface CharacterTargetSpec {kind:"character";min:number;max:number;distinct:boolean;includeSelf:boolean;team:"any"|"ally"|"enemy";presence:"inPlay"|"notEliminated";maxDistance?:number|"unlimited";lifeStates?:Array<"alive"|"dying"|"deadNotEliminated">}
export interface CardTargetSpec {kind:"card";min:number;max:number;distinct:boolean;zoneTypes:ZoneType[];relation:"any"|"self"|"other";publicOnly:boolean;templateIds?:string[]}
export type TargetSpec=CharacterTargetSpec|CardTargetSpec;
export interface TargetOffer {spec:TargetSpec;legalTargetRefs:string[]}

function assertSpec(spec:TargetSpec):void{if(!Number.isInteger(spec.min)||!Number.isInteger(spec.max)||spec.min<0||spec.max<spec.min)throw new Error("TARGET_SPEC_COUNT_INVALID");}
export function calculateTargetOffer(state:AuthoritativeGameState,actorSeat:Seat,spec:TargetSpec):TargetOffer{
  assertSpec(spec);const actor=state.players.find(player=>player.seat===actorSeat);if(!actor)throw new Error("PLAYER_NOT_FOUND");let legalTargetRefs:string[];
  if(spec.kind==="character")legalTargetRefs=state.players.filter(target=>{
    if(!spec.includeSelf&&target.seat===actorSeat)return false;if(spec.team==="ally"&&target.team!==actor.team)return false;if(spec.team==="enemy"&&target.team===actor.team)return false;
    if(spec.presence==="inPlay"&&(target.presence!=="inPlay"||target.lifeState==="eliminated"))return false;if(spec.presence==="notEliminated"&&target.lifeState==="eliminated")return false;
    if(spec.maxDistance!==undefined&&spec.maxDistance!=="unlimited"&&calculateEffectiveDistance(state,actorSeat,target.seat)>spec.maxDistance)return false;return !spec.lifeStates||spec.lifeStates.includes(target.lifeState as "alive"|"dying"|"deadNotEliminated");
  }).map(target=>`character:${target.seat}`);
  else legalTargetRefs=Object.values(state.cards).filter(card=>{const zone=state.zones[card.zoneRef]!;if(!spec.zoneTypes.includes(zone.zoneType))return false;if(spec.relation==="self"&&zone.ownerSeat!==actorSeat)return false;if(spec.relation==="other"&&zone.ownerSeat===actorSeat)return false;if(spec.publicOnly&&!card.faceUp)return false;return !spec.templateIds||spec.templateIds.includes(card.templateId);}).map(card=>card.cardRef);
  return{spec:structuredClone(spec),legalTargetRefs};
}

export function validateTargetSelection(offer:TargetOffer,selectedRefs:readonly string[]):void{
  if(selectedRefs.length<offer.spec.min||selectedRefs.length>offer.spec.max)throw new Error("SELECTION_COUNT_INVALID");if(offer.spec.distinct&&new Set(selectedRefs).size!==selectedRefs.length)throw new Error("SELECTION_NOT_DISTINCT");const legal=new Set(offer.legalTargetRefs);if(selectedRefs.some(ref=>!legal.has(ref)))throw new Error("TARGET_NO_LONGER_LEGAL");
}
