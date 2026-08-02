import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState} from "../engine/state.js";
import {BerserkerRageSession} from "../engine/berserkerRage.js";
import {C6LaserSweepSession,C6FocusedBombardmentSession} from "../engine/c6h8o6.js";
import {CriticalPenetrationSession} from "../engine/triggerAttackFollowup.js";
import {CrystalCrabActivePincerSession} from "../engine/crystalCrab.js";
import {DarkKnightFinalStrikeSession} from "../engine/darkKnightFinalStrike.js";
import {DemolitionTeamSession} from "../engine/demolitionTeam.js";
import {DivineBarrierDamageSession} from "../engine/divineBarrier.js";
import {EngineerMechChoiceSession} from "../engine/engineer.js";
import {ExtraGemDeathTransferSession} from "../engine/dying.js";
import {ForesightSession} from "../engine/foresight.js";
import {GoldenMaskTargetSession} from "../engine/goldenMask.js";
import {InternetAddictionSession} from "../engine/internetAddiction.js";
import {MinerSession} from "../engine/miner.js";
import {OwlSession} from "../engine/owl.js";
import {PurpleLordHeroBladeSession} from "../engine/purpleLord.js";
import {QiBallDismantleSession} from "../engine/qiMaster.js";
import {ReforgeFurnaceSelectionSession} from "../engine/furnace.js";
import {SheepSession} from "../engine/sheep.js";
import {SuperBabyResponseSession} from "../engine/superBaby.js";
import {TemporaryCoinSession} from "../engine/coinGun.js";
import {BombDetonationSession} from "../engine/trapMaster.js";
import {TriggerCardSelectionSession} from "../engine/triggerCardSelection.js";
import {ValkyrieResponseSession} from "../engine/valkyrie.js";
import {ParticleEagleFollowUpSession} from "../engine/attackLifecycle.js";
import {WrenchChoiceSession} from "../engine/wrenchWeapon.js";
import {WizardSpellStrikeSession} from "../engine/wizard.js";

type Session={state:AuthoritativeGameState;handle(command:any):any;handleTimeout?(commandId:string):any};
type Factory=(s:AuthoritativeGameState,r:LoadedRuleset,deadline:()=>number)=>Session;
const construct=(Class:new(...args:any[])=>unknown,args:any[])=>new Class(...args) as Session;
const standard=(Class:new(...args:any[])=>unknown):Factory=>(s,r,d)=>construct(Class,[s,r,d]);
const factories:Record<string,Factory>={
 berserkerRage:standard(BerserkerRageSession),c6LaserSweepRequest:standard(C6LaserSweepSession),c6FocusedBombardmentRequest:standard(C6FocusedBombardmentSession),criticalPenetration:standard(CriticalPenetrationSession),crystalCrabActivePincer:standard(CrystalCrabActivePincerSession),darkKnightFinalStrike:standard(DarkKnightFinalStrikeSession),divineBarrierDamage:standard(DivineBarrierDamageSession),engineerMechChoice:standard(EngineerMechChoiceSession),extraGemDeathTransfer:standard(ExtraGemDeathTransferSession),extraGemDyingResult:standard(ExtraGemDeathTransferSession),foresightDrawChoice:standard(ForesightSession),goldenMaskTarget:standard(GoldenMaskTargetSession),internetAddictionDodgeRequest:standard(InternetAddictionSession),minerDigAtPlayEnd:standard(MinerSession),minerNaturalExitTarget:standard(MinerSession),minerSourceDismantle:standard(MinerSession),owlCounterattack:standard(OwlSession),purpleLordHeroBlade:standard(PurpleLordHeroBladeSession),qiBallDismantle:standard(QiBallDismantleSession),reforgeFurnaceSelection:standard(ReforgeFurnaceSelectionSession),sheepPhaseOneDodgeRequest:standard(SheepSession),superBabyDodgeRequest:standard(SuperBabyResponseSession),temporaryCoinImmediateUse:standard(TemporaryCoinSession),trapBombDetonation:standard(BombDetonationSession),triggerCardSelection:standard(TriggerCardSelectionSession),valkyrieBossResponse:standard(ValkyrieResponseSession),weaponParticleEagleFollowUp:standard(ParticleEagleFollowUpSession),weaponW61Choice:standard(WrenchChoiceSession),wizardSpellStrike:standard(WizardSpellStrikeSession),
 demolitionOptionalDiscard:(s,r)=>{const x=new DemolitionTeamSession(s,r);return{get state(){return x.state},handle:c=>x.handleChoice(c),handleTimeout:id=>x.handleTimeout(id)}},demolitionWeaponOverflow:(s,r)=>{const x=new DemolitionTeamSession(s,r);return{get state(){return x.state},handle:c=>x.handleChoice(c),handleTimeout:id=>x.handleTimeout(id)}},
};
export function supportsWindow(kind:string){return kind in factories;}
export function executeWindow(state:AuthoritativeGameState,ruleset:LoadedRuleset,userId:string,deadline:()=>number,input:{commandId:string;gameId:string;expectedStateRevision:number;promptId:string;offerId:string;selections:Record<string,unknown[]>}){const factory=factories[state.pendingWindows.find(x=>x.promptId===input.promptId)?.kind??""];if(!factory)return null;const cards=(input.selections.cards??[]).filter((x):x is string=>typeof x==="string"),targets=(input.selections.targets??[]).filter((x):x is string=>typeof x==="string"),options=input.selections.option??input.selections.mode??input.selections.number??[],session=factory(state,ruleset,deadline),command={commandId:input.commandId,gameId:input.gameId,expectedStateRevision:input.expectedStateRevision,actorUserId:userId,promptId:input.promptId,offerId:input.offerId,cardRefs:cards,cardRef:cards[0],targetRefs:targets,targetRef:targets[0],weaponRef:cards[0],choice:options[0],mode:options[0],amount:options[0],confirm:input.selections.confirm?.[0]===true};return{session,result:session.handle(command)};}
export function timeoutWindow(state:AuthoritativeGameState,ruleset:LoadedRuleset,deadline:()=>number,commandId:string){const window=state.pendingWindows[0],factory=window?factories[window.kind]:undefined;if(!factory)return null;const session=factory(state,ruleset,deadline);if(!session.handleTimeout)return null;return{session,result:session.handleTimeout(commandId)};}
