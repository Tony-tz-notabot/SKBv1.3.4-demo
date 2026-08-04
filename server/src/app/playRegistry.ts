import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {AttackCommandSession} from "../engine/attackCommands.js";
import {buildBasicSupportOffers,BasicSupportCardSession} from "../engine/basicSupportCards.js";
import {buildWeaponEquipOffers,buildWeaponDiscardOffers,WeaponEquipSession,WeaponDiscardSession} from "../engine/weaponEquipment.js";
import {buildArmorEquipOffers,ArmorEquipSession} from "../engine/armorEquipment.js";
import {buildMountEquipOffers,buildMountDiscardOffers,MountEquipSession,MountDiscardSession} from "../engine/mountEquipment.js";
import {buildTalentEquipOffers,buildTalentDiscardOffers,TalentEquipSession,TalentDiscardSession} from "../engine/talentEquipment.js";
import {buildWeaponSynthesisOffers,WeaponSynthesisSession} from "../engine/weaponSynthesis.js";
import {buildToxicReagentOffers,ToxicReagentSession} from "../engine/alchemist.js";
import {buildAssassinCreedKillOffers,AssassinCreedKillSession} from "../engine/assassin.js";
import {buildBloodAltarOffers,BloodAltarSession} from "../engine/bloodAltar.js";
import {buildDarkKnightActionOffers,DarkKnightActionSession} from "../engine/darkKnight.js";
import {buildDemolitionTeamOffers,DemolitionTeamSession} from "../engine/demolitionTeam.js";
import {buildDemonicNatureOffers,DemonicNatureSession} from "../engine/demonmancer.js";
import {buildDivineBarrierActiveOffers,DivineBarrierActiveSession} from "../engine/divineBarrier.js";
import {buildVineOffers,VineSession} from "../engine/druid.js";
import {buildElementSatchelOffers,ElementSatchelSession} from "../engine/elementalist.js";
import {buildMechAttackOffers,buildMechExitOffers,MechAttackSession,MechExitSession} from "../engine/engineer.js";
import {buildGeneralMortarOffers,GeneralMortarSession} from "../engine/general.js";
import {buildOriginFurnaceOffers,buildReforgeFurnaceOffers,OriginFurnaceSession,ReforgeFurnaceSession} from "../engine/furnace.js";
import {buildInternetAddictionOffers,InternetAddictionSession} from "../engine/internetAddiction.js";
import {buildNecromancerMarkOffers,NecromancerMarkSession} from "../engine/necromancer.js";
import {buildOfferingPoolOffers,OfferingPoolSession} from "../engine/offeringPool.js";
import {buildPriestOffers,PriestSession} from "../engine/priest.js";
import {buildQiBallOffers,QiBallSession} from "../engine/qiMaster.js";
import {buildRobotOverloadOffers,RobotOverloadSession} from "../engine/robot.js";
import {buildSheepOffers,SheepSession} from "../engine/sheep.js";
import {buildSheepSynthesisOffers,SheepSynthesisSession} from "../engine/sheepSynthesis.js";
import {buildDeathNoteOffers,buildHornSquadOffers,DeathNoteSession,HornSquadSession} from "../engine/specialCards.js";
import {buildStatuePlayOffers,StatuePlaySession} from "../engine/statueDoubleTrigger.js";import {buildSuperBabyOffers,SuperBabyUseSession} from "../engine/superBaby.js";
import {buildBomberOffers,BomberSession} from "../engine/trapMaster.js";
import {buildDeadlyCurseOffers,DeadlyCurseSession} from "../engine/traveler.js";
import {buildWerewolfNotebookOffers,WerewolfNotebookSession} from "../engine/werewolf.js";

export type RawPlayOffer=Record<string,unknown>&{offerId:string};
type Session={state:AuthoritativeGameState;handle(command:any):any};
type Entry={offers:(s:AuthoritativeGameState,r:LoadedRuleset,n:Seat,userId:string,deadline:()=>number)=>RawPlayOffer[];session:(s:AuthoritativeGameState,r:LoadedRuleset,deadline:()=>number)=>Session};
const as=(value:unknown)=>value as RawPlayOffer[];
const stringArray=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
const seatFromTarget=(ref:string|undefined|null):number|undefined=>{if(!ref)return undefined;const match=/^character:([1-4])$/.exec(ref);return match?Number(match[1]):undefined;};
const standard=(builder:(s:AuthoritativeGameState,r:LoadedRuleset,n:Seat)=>unknown[],SessionClass:new(...args:any[])=>Session,clockThird=false):Entry=>({offers:(s,r,n)=>as(builder(s,r,n)),session:(s,r,d)=>new SessionClass(s,r,...(clockThird?[d]:[]))});
const noRules=(builder:(s:AuthoritativeGameState,n:Seat)=>unknown[],SessionClass:new(...args:any[])=>Session):Entry=>({offers:(s,_r,n)=>as(builder(s,n)),session:s=>new SessionClass(s)});
export function buildPlayCommand(raw:RawPlayOffer,input:{commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;selections:Record<string,unknown[]>}):Record<string,unknown>{
 const cards=stringArray(input.selections.cards),targets=stringArray(input.selections.targets),weapons=stringArray(input.selections.weapons),killCards=stringArray(input.selections.killCards),resourceCards=stringArray(input.selections.resourceCards),rawTargetRef=typeof raw.targetRef==="string"?raw.targetRef:undefined,targetRef=targets[0]??rawTargetRef,rawCardRef=typeof raw.cardRef==="string"?raw.cardRef:undefined,rawWeaponRef=typeof raw.weaponRef==="string"?raw.weaponRef:undefined,boyRefs=stringArray(raw.boyRefs),girlRefs=stringArray(raw.girlRefs);
 return {...raw,commandId:input.commandId,gameId:input.gameId,expectedStateRevision:input.expectedStateRevision,actorUserId:input.actorUserId,promptId:input.promptId,offerId:input.offerId,cardRefs:cards,cardRef:cards[0]??rawCardRef,targetRefs:targets,targetRef,targetSeat:seatFromTarget(targetRef),killCardRefs:killCards.length?killCards:cards,killCardRef:killCards[0]??cards[0]??rawCardRef,resourceCardRefs:resourceCards,weaponRef:weapons[0]??rawWeaponRef,...(boyRefs.length?{boyRef:cards.find(ref=>boyRefs.includes(ref))??null}:{}),...(girlRefs.length?{girlRef:cards.find(ref=>girlRefs.includes(ref))??null}:{}),confirm:input.selections.confirm?.[0]===true,confirmOnlyWeapon:input.selections.confirm?.[0]===true};
}
const entries:Entry[]=[
 {offers:(s,r,_n,userId,d)=>{const x=new AttackCommandSession(s,r,d).offerFor(userId);return x?[x as unknown as RawPlayOffer]:[]},session:(s,r,d)=>new AttackCommandSession(s,r,d)},
 standard(buildBasicSupportOffers,BasicSupportCardSession),standard(buildWeaponEquipOffers,WeaponEquipSession),noRules(buildWeaponDiscardOffers,WeaponDiscardSession),standard(buildArmorEquipOffers,ArmorEquipSession),standard(buildMountEquipOffers,MountEquipSession),noRules(buildMountDiscardOffers,MountDiscardSession),
 {offers:(s,_r,n)=>as(buildTalentEquipOffers(s,n)),session:(s,r)=>new TalentEquipSession(s,r)},noRules(buildTalentDiscardOffers,TalentDiscardSession),standard(buildWeaponSynthesisOffers,WeaponSynthesisSession),standard(buildToxicReagentOffers,ToxicReagentSession),standard(buildAssassinCreedKillOffers,AssassinCreedKillSession),standard(buildBloodAltarOffers,BloodAltarSession),standard(buildDarkKnightActionOffers,DarkKnightActionSession),{offers:(s,r,n)=>as(buildDemolitionTeamOffers(s,r,n)),session:(s,r)=>{const x=new DemolitionTeamSession(s,r);return{get state(){return x.state},handle:c=>x.handleUse(c)}}},standard(buildDemonicNatureOffers,DemonicNatureSession),standard(buildDivineBarrierActiveOffers,DivineBarrierActiveSession),standard(buildVineOffers,VineSession),standard(buildElementSatchelOffers,ElementSatchelSession),standard(buildMechAttackOffers,MechAttackSession),noRules(buildMechExitOffers,MechExitSession),standard(buildGeneralMortarOffers,GeneralMortarSession),standard(buildOriginFurnaceOffers,OriginFurnaceSession),standard(buildReforgeFurnaceOffers,ReforgeFurnaceSession),standard(buildInternetAddictionOffers,InternetAddictionSession,true),standard(buildNecromancerMarkOffers,NecromancerMarkSession),standard(buildOfferingPoolOffers,OfferingPoolSession),standard(buildPriestOffers,PriestSession),standard(buildQiBallOffers,QiBallSession),standard(buildRobotOverloadOffers,RobotOverloadSession),standard(buildSheepOffers,SheepSession,true),standard(buildSheepSynthesisOffers,SheepSynthesisSession),standard(buildDeathNoteOffers,DeathNoteSession),standard(buildHornSquadOffers,HornSquadSession),{offers:(s,_r,n)=>as(buildStatuePlayOffers(s,n)),session:(s,r,d)=>new StatuePlaySession(s,r,d())},standard(buildSuperBabyOffers,SuperBabyUseSession),standard(buildBomberOffers,BomberSession),standard(buildDeadlyCurseOffers,DeadlyCurseSession),standard(buildWerewolfNotebookOffers,WerewolfNotebookSession),
];
export function playOffers(state:AuthoritativeGameState,ruleset:LoadedRuleset,seat:Seat,userId:string,deadline:()=>number){return entries.flatMap(entry=>{try{return entry.offers(state,ruleset,seat,userId,deadline)}catch{return[]}});}
export function executePlayOffer(state:AuthoritativeGameState,ruleset:LoadedRuleset,userId:string,deadline:()=>number,input:{commandId:string;gameId:string;expectedStateRevision:number;promptId:string;offerId:string;selections:Record<string,unknown[]>}){const seat=state.players.find(x=>x.userId===userId)?.seat;if(!seat)return null;for(const entry of entries){const raw=entry.offers(state,ruleset,seat,userId,deadline).find(x=>x.offerId===input.offerId);if(!raw)continue;const command=buildPlayCommand(raw,{...input,actorUserId:userId});const session=entry.session(state,ruleset,deadline),result=session.handle(command);return{session,result,raw};}return null;}
