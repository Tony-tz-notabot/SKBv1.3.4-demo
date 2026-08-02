import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {AttackCommandSession} from "../engine/attackCommands.js";
import {buildBasicSupportOffers,BasicSupportCardSession} from "../engine/basicSupportCards.js";
import {buildWeaponEquipOffers,buildWeaponDiscardOffers,WeaponEquipSession,WeaponDiscardSession} from "../engine/weaponEquipment.js";
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
import {buildStatuePlayOffers,StatuePlaySession} from "../engine/statueDoubleTrigger.js";
import {buildSuperBabyOffers,SuperBabyUseSession} from "../engine/superBaby.js";
import {buildBomberOffers,BomberSession} from "../engine/trapMaster.js";
import {buildDeadlyCurseOffers,DeadlyCurseSession} from "../engine/traveler.js";
import {buildWerewolfNotebookOffers,WerewolfNotebookSession} from "../engine/werewolf.js";

export type RawPlayOffer=Record<string,unknown>&{offerId:string};
type Session={state:AuthoritativeGameState;handle(command:any):any};
type Entry={offers:(s:AuthoritativeGameState,r:LoadedRuleset,n:Seat,userId:string,deadline:()=>number)=>RawPlayOffer[];session:(s:AuthoritativeGameState,r:LoadedRuleset,deadline:()=>number)=>Session};
const as=(value:unknown)=>value as RawPlayOffer[];
const standard=(builder:(s:AuthoritativeGameState,r:LoadedRuleset,n:Seat)=>unknown[],SessionClass:new(...args:any[])=>Session,clockThird=false):Entry=>({offers:(s,r,n)=>as(builder(s,r,n)),session:(s,r,d)=>new SessionClass(s,r,...(clockThird?[d]:[]))});
const noRules=(builder:(s:AuthoritativeGameState,n:Seat)=>unknown[],SessionClass:new(...args:any[])=>Session):Entry=>({offers:(s,_r,n)=>as(builder(s,n)),session:s=>new SessionClass(s)});
const entries:Entry[]=[
 {offers:(s,r,_n,userId,d)=>{const x=new AttackCommandSession(s,r,d).offerFor(userId);return x?[x as unknown as RawPlayOffer]:[]},session:(s,r,d)=>new AttackCommandSession(s,r,d)},
 standard(buildBasicSupportOffers,BasicSupportCardSession),standard(buildWeaponEquipOffers,WeaponEquipSession),noRules(buildWeaponDiscardOffers,WeaponDiscardSession),standard(buildMountEquipOffers,MountEquipSession),noRules(buildMountDiscardOffers,MountDiscardSession),
 {offers:(s,_r,n)=>as(buildTalentEquipOffers(s,n)),session:(s,r)=>new TalentEquipSession(s,r)},noRules(buildTalentDiscardOffers,TalentDiscardSession),standard(buildWeaponSynthesisOffers,WeaponSynthesisSession),standard(buildToxicReagentOffers,ToxicReagentSession),standard(buildAssassinCreedKillOffers,AssassinCreedKillSession),standard(buildBloodAltarOffers,BloodAltarSession),standard(buildDarkKnightActionOffers,DarkKnightActionSession),{offers:(s,r,n)=>as(buildDemolitionTeamOffers(s,r,n)),session:(s,r)=>{const x=new DemolitionTeamSession(s,r);return{get state(){return x.state},handle:c=>x.handleUse(c)}}},standard(buildDemonicNatureOffers,DemonicNatureSession),standard(buildDivineBarrierActiveOffers,DivineBarrierActiveSession),standard(buildVineOffers,VineSession),standard(buildElementSatchelOffers,ElementSatchelSession),standard(buildMechAttackOffers,MechAttackSession),noRules(buildMechExitOffers,MechExitSession),standard(buildGeneralMortarOffers,GeneralMortarSession),standard(buildOriginFurnaceOffers,OriginFurnaceSession),standard(buildReforgeFurnaceOffers,ReforgeFurnaceSession),standard(buildInternetAddictionOffers,InternetAddictionSession,true),standard(buildNecromancerMarkOffers,NecromancerMarkSession),standard(buildOfferingPoolOffers,OfferingPoolSession),standard(buildPriestOffers,PriestSession),standard(buildQiBallOffers,QiBallSession),standard(buildRobotOverloadOffers,RobotOverloadSession),standard(buildSheepOffers,SheepSession,true),standard(buildSheepSynthesisOffers,SheepSynthesisSession),standard(buildDeathNoteOffers,DeathNoteSession),standard(buildHornSquadOffers,HornSquadSession),{offers:(s,_r,n)=>as(buildStatuePlayOffers(s,n)),session:(s,r)=>new StatuePlaySession(s,r)},standard(buildSuperBabyOffers,SuperBabyUseSession),standard(buildBomberOffers,BomberSession),standard(buildDeadlyCurseOffers,DeadlyCurseSession),standard(buildWerewolfNotebookOffers,WerewolfNotebookSession),
];
export function playOffers(state:AuthoritativeGameState,ruleset:LoadedRuleset,seat:Seat,userId:string,deadline:()=>number){return entries.flatMap(entry=>{try{return entry.offers(state,ruleset,seat,userId,deadline)}catch{return[]}});}
export function executePlayOffer(state:AuthoritativeGameState,ruleset:LoadedRuleset,userId:string,deadline:()=>number,input:{commandId:string;gameId:string;expectedStateRevision:number;promptId:string;offerId:string;selections:Record<string,unknown[]>}){const seat=state.players.find(x=>x.userId===userId)?.seat;if(!seat)return null;for(const entry of entries){const raw=entry.offers(state,ruleset,seat,userId,deadline).find(x=>x.offerId===input.offerId);if(!raw)continue;const cards=(input.selections.cards??[]).filter((x):x is string=>typeof x==="string"),targets=(input.selections.targets??[]).filter((x):x is string=>typeof x==="string"),weapons=(input.selections.weapons??[]).filter((x):x is string=>typeof x==="string"),command={...raw,commandId:input.commandId,gameId:input.gameId,expectedStateRevision:input.expectedStateRevision,actorUserId:userId,promptId:input.promptId,offerId:input.offerId,cardRefs:cards,cardRef:cards[0]??raw.cardRef,targetRefs:targets,targetRef:targets[0]??raw.targetRef,killCardRefs:(input.selections.killCards??cards).filter((x):x is string=>typeof x==="string"),resourceCardRefs:(input.selections.resourceCards??[]).filter((x):x is string=>typeof x==="string"),weaponRef:weapons[0]??raw.weaponRef,confirm:input.selections.confirm?.[0]===true};const session=entry.session(state,ruleset,deadline),result=session.handle(command);return{session,result,raw};}return null;}
