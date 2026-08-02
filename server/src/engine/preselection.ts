import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState,Seat} from "./state.js";
import {validateAuthoritativeState} from "./stateValidation.js";
import {EngineTransaction} from "./transaction.js";
import type {TransactionCommit} from "./types.js";

export const weaponSlotRefs=(seat:Seat)=>[`weapon:1:${seat}`,`weapon:2:${seat}`,`weapon:3:${seat}`,`thirdWeapon:${seat}`];
export function setWeaponPreselection(state:AuthoritativeGameState,seat:Seat,weaponSlot:string|null,modeId:string|null,ruleset:LoadedRuleset):TransactionCommit<AuthoritativeGameState>{
  const normalizedModeId=modeId==="default"?null:modeId;
  if(!state.players.some(player=>player.seat===seat))throw new Error("PLAYER_NOT_FOUND");if(weaponSlot!==null&&!weaponSlotRefs(seat).includes(weaponSlot))throw new Error("PRESELECTION_SLOT_INVALID");
  if(weaponSlot!==null){const zone=state.zones[weaponSlot];if(!zone||!(zone.zoneType==="weaponSlot"||zone.zoneType==="thirdWeaponSlot"))throw new Error("PRESELECTION_SLOT_INVALID");const cardRef=zone.orderedCardRefs[0];if(cardRef&&normalizedModeId!==null){const document=ruleset.documents.get("weapon-rules.json") as {templates:Array<{weaponId:string;modeSelection?:{modeIds?:string[];playerSelectable?:boolean}}>};const weapon=document.templates.find(item=>item.weaponId===state.cards[cardRef]!.templateId);if(!weapon?.modeSelection?.playerSelectable||!weapon.modeSelection.modeIds?.includes(normalizedModeId))throw new Error("PRESELECTION_MODE_INVALID");}}
  const tx=new EngineTransaction(state);tx.draft.preselection[seat]={weaponSlot,modeId:normalizedModeId};const committed=tx.commit();validateAuthoritativeState(committed.state);return committed;
}
