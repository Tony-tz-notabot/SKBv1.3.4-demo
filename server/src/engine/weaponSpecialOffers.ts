import type {LoadedRuleset} from "../ruleset/types.js";
import type {AuthoritativeGameState,Seat} from "./state.js";
import {calculateEffectiveDistance} from "./distance.js";
import {activateMeteorWeapon} from "./meteorWeapon.js";
import {aimLaserFish,cancelLaserFishAim} from "./laserFishWeapon.js";
import {LaserRainSession} from "./laserRain.js";
import {weaponSlotRefs} from "./preselection.js";
import type {DomainEvent} from "./types.js";

// 武器专属主动能力报价：陨星杖（W-58 全场场地攻击）、激光鱼（W-64 瞄准/取消瞄准）、
// 激光雨（W-12 蓄力 1/2 展示伤害）。引擎执行器已存在，这里补应用层报价与命令适配。
const handKills=(state:AuthoritativeGameState,seat:Seat)=>state.zones[`hand:${seat}`]!.orderedCardRefs.filter(ref=>state.cards[ref]!.templateId.startsWith("basic.kill."));
const equipmentEnabled=(state:AuthoritativeGameState,seat:Seat)=>{const p=state.players.find(x=>x.seat===seat)!;return p.markers.equipmentEffectsDisabled!==true&&!p.statuses.some(s=>s.statusId==="status.equipmentDisabled");};
const equippedRef=(state:AuthoritativeGameState,seat:Seat,weaponId:string)=>Object.values(state.zones).filter(z=>z.ownerSeat===seat&&["weaponSlot","thirdWeaponSlot"].includes(z.zoneType)).flatMap(z=>z.orderedCardRefs).find(ref=>state.cards[ref]?.templateId===weaponId);
const inPlayTargets=(state:AuthoritativeGameState,seat:Seat,maxDistance:number|null)=>state.players.filter(p=>p.presence==="inPlay"&&p.lifeState!=="eliminated"&&p.seat!==seat&&(maxDistance===null||calculateEffectiveDistance(state,seat,p.seat)<=maxDistance)).map(p=>`character:${p.seat}`);
const chargeProgress=(state:AuthoritativeGameState,seat:Seat,weaponRef:string)=>Number(state.cards[weaponRef]?.runtime.chargeProgress??0);

export interface WeaponSpecialOffer{
  offerId:string;
  kind:"activateWeapon";
  weaponRef:string;
  legalKillCardRefs:string[];
  legalTargetRefs?:string[];
  targetCount?:number;
  aimActive?:boolean;
  stateRevision:number;
}
export function buildWeaponSpecialOffers(state:AuthoritativeGameState,seat:Seat):WeaponSpecialOffer[]{
  if(state.lifecycle!=="inProgress"||state.activeSeat!==seat||state.phase!=="play"||state.phaseBoundary!=="body"||state.combat.attack)return[];
  if(!state.pendingWindows.some(w=>w.kind==="playPhaseAction"&&w.prioritySeat===seat))return[];
  const p=state.players.find(x=>x.seat===seat)!;
  if(p.markers.equipmentEffectsDisabled===true||p.statuses.some(s=>s.statusId==="status.equipmentDisabled"))return[];
  const kills=handKills(state,seat),out:WeaponSpecialOffer[]=[];
  // 陨星杖 W-58：CD=2，全场场地 3 攻击，需要【杀】与次数
  const meteor=equippedRef(state,seat,"weapon.w58");
  if(meteor&&Number(state.cards[meteor]!.runtime.cooldownOwnPreparesUntilReady??0)<=0&&Number(p.limits.attackCountRemaining??0)>=1&&kills.length>=1)
    out.push({offerId:`offer:weapon-w58-meteor:${seat}`,kind:"activateWeapon",weaponRef:meteor,legalKillCardRefs:kills,stateRevision:state.stateRevision});
  // 激光鱼 W-64：无瞄准时建立瞄准（目标+杀+次数）；已瞄准时消耗一张杀取消瞄准
  const fish=equippedRef(state,seat,"weapon.w64");
  if(fish){
    const aim=state.cards[fish]!.runtime.aimTarget;
    if(typeof aim==="string"){
      if(kills.length>=1)out.push({offerId:`offer:weapon-w64-cancel-aim:${seat}`,kind:"activateWeapon",weaponRef:fish,legalKillCardRefs:kills,aimActive:true,stateRevision:state.stateRevision});
    }else if(Number(p.limits.attackCountRemaining??0)>=1&&kills.length>=1){
      const targets=inPlayTargets(state,seat,3);
      if(targets.length)out.push({offerId:`offer:weapon-w64-aim:${seat}`,kind:"activateWeapon",weaponRef:fish,legalKillCardRefs:kills,legalTargetRefs:targets,targetCount:1,stateRevision:state.stateRevision});
    }
  }
  // 激光雨 W-12：蓄力 1/2 时展示牌堆顶并造成场地伤害
  const slot=state.preselection[seat]?.weaponSlot,rainRef=slot&&weaponSlotRefs(seat).includes(slot)?state.zones[slot]!.orderedCardRefs[0]:undefined;
  if(rainRef&&state.cards[rainRef]!.templateId==="weapon.w12"){
    const charge=chargeProgress(state,seat,rainRef);
    if((charge===1||charge===2)&&Number(p.limits.attackCountRemaining??0)>=1&&kills.length>=1){
      const targets=inPlayTargets(state,seat,2);
      if(targets.length)out.push({offerId:`offer:weapon-w12-display:${seat}`,kind:"activateWeapon",weaponRef:rainRef,legalKillCardRefs:kills,legalTargetRefs:targets,targetCount:1,stateRevision:state.stateRevision});
    }
  }
  return out;
}
export interface WeaponSpecialCommand{commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;killCardRefs:string[];targetRefs?:string[]}
export type WeaponSpecialResult={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
const seatFromTarget=(ref:string|undefined):Seat|null=>{const m=ref?/^character:([1-4])$/.exec(ref):null;return m?Number(m[1]) as Seat:null;};
export class WeaponSpecialSession{
  #state:AuthoritativeGameState;#results=new Map<string,WeaponSpecialResult>();
  constructor(s:AuthoritativeGameState,private r:LoadedRuleset){this.#state=s}
  get state(){return this.#state}
  handle(c:WeaponSpecialCommand):WeaponSpecialResult{
    const old=this.#results.get(c.commandId);if(old)return structuredClone(old);
    const reject=(reasonCode:string,refreshRequired=true):WeaponSpecialResult=>{const x={accepted:false as const,commandId:c.commandId,stateRevision:this.#state.stateRevision,reasonCode,refreshRequired};this.#results.set(c.commandId,x);return structuredClone(x)};
    if(c.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);
    if(c.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);
    const actor=this.#state.players.find(p=>p.userId===c.actorUserId);
    if(!actor||!this.#state.pendingWindows.some(w=>w.promptId===c.promptId&&w.kind==="playPhaseAction"&&w.prioritySeat===actor.seat))return reject("NOT_YOUR_PRIORITY",false);
    const offer=buildWeaponSpecialOffers(this.#state,actor.seat).find(x=>x.offerId===c.offerId);
    if(!offer)return reject("OFFER_EXPIRED",true);
    const killRef=c.killCardRefs?.[0];
    if(!killRef||!offer.legalKillCardRefs.includes(killRef)||this.#state.cards[killRef]?.zoneRef!==`hand:${actor.seat}`)return reject("ATTACK_KILL_COST_INVALID",false);
    try{
      let commit;
      if(c.offerId.includes("w58-meteor")){
        commit=activateMeteorWeapon(this.#state,actor.seat,killRef);
      }else if(c.offerId.includes("w64-aim")){
        const targetSeat=seatFromTarget(c.targetRefs?.[0]);
        if(targetSeat===null||!offer.legalTargetRefs?.includes(`character:${targetSeat}`))return reject("TARGET_NO_LONGER_LEGAL",true);
        commit=aimLaserFish(this.#state,actor.seat,targetSeat,killRef);
      }else if(c.offerId.includes("w64-cancel-aim")){
        commit=cancelLaserFishAim(this.#state,actor.seat,killRef);
      }else if(c.offerId.includes("w12-display")){
        const targetRef=c.targetRefs?.[0];
        if(!targetRef||!offer.legalTargetRefs?.includes(targetRef))return reject("TARGET_NO_LONGER_LEGAL",true);
        const session=new LaserRainSession(this.#state,this.r),result=session.handle({commandId:c.commandId,gameId:c.gameId,expectedStateRevision:c.expectedStateRevision,actorUserId:c.actorUserId,promptId:c.promptId,offerId:"offer:weapon-w12-display",targetRef,killCardRef:killRef});
        if(!result.accepted)return reject(result.reasonCode,result.refreshRequired);
        this.#state=session.state;
        const accepted={accepted:true as const,commandId:c.commandId,previousRevision:c.expectedStateRevision,stateRevision:this.#state.stateRevision,events:result.events};
        this.#results.set(c.commandId,accepted);
        return structuredClone(accepted);
      }else return reject("OFFER_EXPIRED",true);
      this.#state=commit.state;
      const result={accepted:true as const,commandId:c.commandId,previousRevision:commit.previousRevision,stateRevision:this.#state.stateRevision,events:commit.events};
      this.#results.set(c.commandId,result);
      return structuredClone(result);
    }catch(error){
      if(error instanceof Error)return reject(error.message,true);
      throw error;
    }
  }
}
