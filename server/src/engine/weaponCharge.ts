import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState,Seat} from "./state.js";
import {validateAuthoritativeState} from "./stateValidation.js";
import {EngineTransaction} from "./transaction.js";
import type {DomainEvent,TransactionCommit} from "./types.js";
import {weaponSlotRefs} from "./preselection.js";

// 蓄力：出牌阶段消耗 1 张【杀】与 1 次可攻击次数，使预选蓄力武器的蓄力进度 +1（不视为攻击，
// 不结束出牌阶段）。规则配置来自 weapon-rules.json 的 charge.chargeAction。
interface ChargeActionSpec { phase:string; costs:{killCards:number;attackCount:number}; targetRule:{min:number;max:number}; increment:number; clampToMax:boolean }
interface ChargeSpec { counterId:string; min:number; max:number; chargeAction:ChargeActionSpec }
interface WeaponTemplate { weaponId:string; charge?:ChargeSpec }
const document=(r:LoadedRuleset)=>(r.documents.get("weapon-rules.json") as {templates:WeaponTemplate[]});
const handKills=(state:AuthoritativeGameState,seat:Seat)=>state.zones[`hand:${seat}`]!.orderedCardRefs.filter(ref=>state.cards[ref]!.templateId.startsWith("basic.kill."));
const equipmentEnabled=(state:AuthoritativeGameState,seat:Seat)=>{const p=state.players.find(x=>x.seat===seat)!;return p.markers.equipmentEffectsDisabled!==true&&!p.statuses.some(s=>s.statusId==="status.equipmentDisabled");};
const turnKey=(state:AuthoritativeGameState,seat:Seat)=>`${state.round}:${seat}`;

export interface WeaponChargeOffer{
  offerId:string;
  kind:"chargeWeapon";
  weaponRef:string;
  legalKillCardRefs:string[];
  chargeCounterId:string;
  current:number;
  max:number;
  stateRevision:number;
}
export function buildWeaponChargeOffers(state:AuthoritativeGameState,r:LoadedRuleset,seat:Seat):WeaponChargeOffer[]{
  if(state.lifecycle!=="inProgress"||state.activeSeat!==seat||state.phase!=="play"||state.phaseBoundary!=="body"||state.combat.attack)return[];
  if(!state.pendingWindows.some(w=>w.kind==="playPhaseAction"&&w.prioritySeat===seat))return[];
  const slot=state.preselection[seat]?.weaponSlot,weaponRef=slot&&weaponSlotRefs(seat).includes(slot)?state.zones[slot]!.orderedCardRefs[0]:undefined;
  if(!weaponRef||!equipmentEnabled(state,seat))return[];
  const weapon=document(r).templates.find(t=>t.weaponId===state.cards[weaponRef]!.templateId),charge=weapon?.charge;
  if(!charge||!charge.chargeAction)return[];
  const current=Number(state.cards[weaponRef]!.runtime[charge.counterId]??0);
  if(!Number.isInteger(current)||current>=charge.max)return[];
  const action=charge.chargeAction;
  if(action.phase!=="owner.play"||action.targetRule.min!==0||action.targetRule.max!==0)return[];
  const p=state.players.find(x=>x.seat===seat)!;
  if(Number(p.limits.attackCountRemaining??0)<action.costs.attackCount)return[];
  const kills=handKills(state,seat);
  if(kills.length<action.costs.killCards)return[];
  return[{offerId:`offer:weapon-charge:${weaponRef}`,kind:"chargeWeapon",weaponRef,legalKillCardRefs:kills,chargeCounterId:charge.counterId,current,max:charge.max,stateRevision:state.stateRevision}];
}
export interface WeaponChargeCommand{commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;killCardRefs:string[];killCardRef?:string}
export type WeaponChargeResult={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
export class WeaponChargeSession{
  #state:AuthoritativeGameState;#results=new Map<string,WeaponChargeResult>();
  constructor(s:AuthoritativeGameState,private r:LoadedRuleset){this.#state=s}
  get state(){return this.#state}
  handle(c:WeaponChargeCommand):WeaponChargeResult{
    const old=this.#results.get(c.commandId);if(old)return structuredClone(old);
    const reject=(reasonCode:string,refreshRequired:boolean):WeaponChargeResult=>{const x={accepted:false as const,commandId:c.commandId,stateRevision:this.#state.stateRevision,reasonCode,refreshRequired};this.#results.set(c.commandId,x);return structuredClone(x)};
    if(c.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);
    if(c.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);
    const actor=this.#state.players.find(p=>p.userId===c.actorUserId),window=actor?this.#state.pendingWindows.find(w=>w.promptId===c.promptId&&w.kind==="playPhaseAction"&&w.prioritySeat===actor.seat):undefined;
    if(!actor||!window)return reject("NOT_YOUR_PRIORITY",false);
    const offer=buildWeaponChargeOffers(this.#state,this.r,actor.seat).find(x=>x.offerId===c.offerId);
    if(!offer)return reject("OFFER_EXPIRED",true);
    const killRef=c.killCardRef??c.killCardRefs?.[0];
    if(!killRef||!offer.legalKillCardRefs.includes(killRef)||this.#state.cards[killRef]?.zoneRef!==`hand:${actor.seat}`)return reject("ATTACK_KILL_COST_INVALID",false);
    const slot=this.#state.preselection[actor.seat]?.weaponSlot,weaponRef=slot&&weaponSlotRefs(actor.seat).includes(slot)?this.#state.zones[slot]!.orderedCardRefs[0]:undefined;
    if(!weaponRef)return reject("WEAPON_NOT_AVAILABLE",true);
    const charge=document(this.r).templates.find(t=>t.weaponId===this.#state.cards[weaponRef]!.templateId)?.charge;
    if(!charge?.chargeAction)return reject("WEAPON_RESOLUTION_MODE_INVALID",true);
    const tx=new EngineTransaction(this.#state),d=tx.draft,p=d.players.find(x=>x.seat===actor.seat)!,key=turnKey(d,actor.seat);
    // 支付【杀】与攻击次数
    const hand=d.zones[`hand:${actor.seat}`]!,i=hand.orderedCardRefs.indexOf(killRef);
    hand.orderedCardRefs.splice(i,1);d.zones.discardPile!.orderedCardRefs.push(killRef);
    Object.assign(d.cards[killRef]!,{zoneRef:"discardPile",ownerSeat:null,controllerSeat:null,faceUp:true});
    p.limits.attackCountRemaining=Number(p.limits.attackCountRemaining)-charge.chargeAction.costs.attackCount;
    // 蓄力进度 +1（上限封顶）
    const before=Number(d.cards[weaponRef]!.runtime[charge.counterId]??0),after=charge.chargeAction.clampToMax?Math.min(before+charge.chargeAction.increment,charge.max):before+charge.chargeAction.increment;
    d.cards[weaponRef]!.runtime[charge.counterId]=after;
    tx.emit("weapon.counter.changed",{cardRef:weaponRef,weaponId:this.#state.cards[weaponRef]!.templateId,counterId:charge.counterId,before,after,scope:"weaponInstance"});
    // 记录本回合蓄力动作（幽灵王冠等依赖该标记）
    if(p.markers.chargeActionTurnKey!==key){p.markers.chargeActionTurnKey=key;p.markers.chargeActionsThisTurn=0;}
    p.markers.chargeActionsThisTurn=Number(p.markers.chargeActionsThisTurn??0)+1;
    tx.emit("charge.action.committed",{seat:actor.seat,count:p.markers.chargeActionsThisTurn});
    tx.emit("card.discarded",{seat:actor.seat,cardRef:killRef,cardId:d.cards[killRef]!.templateId,fromZoneRef:`hand:${actor.seat}`,reason:"charge"});
    const out=tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state=out.state;
    const result={accepted:true as const,commandId:c.commandId,previousRevision:out.previousRevision,stateRevision:out.state.stateRevision,events:out.events};
    this.#results.set(c.commandId,result);
    return structuredClone(result);
  }
}
