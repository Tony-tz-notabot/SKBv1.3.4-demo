import type { LoadedRuleset } from "../ruleset/types.js";
import { beginJudgment } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { beginStatueResolution, buildStatueResolutionOffers, StatueResolutionSession } from "./statueEffects.js";
const ID = "talent.statue_double_trigger";
function active(s: AuthoritativeGameState, n: Seat) {
  const p = s.players.find((x) => x.seat === n)!;
  return (
    p.initialTalentIds.includes(ID) ||
    (p.markers.equipmentEffectsDisabled !== true &&
      !p.statuses.some((status) => status.statusId === "status.equipmentDisabled") &&
      (s.zones[`talent:${n}`]?.orderedCardRefs ?? []).some(
        (ref) => s.cards[ref]?.templateId === ID,
      ))
  );
}
export function buildStatuePlayOffers(s: AuthoritativeGameState, seat: Seat) {
  const window=s.pendingWindows.find(x=>x.kind==="playPhaseAction"&&x.prioritySeat===seat);
  if(s.activeSeat!==seat||s.phase!=="play"||s.phaseBoundary!=="body"||!window||s.combat.attack)return [];
  return (s.zones[`hand:${seat}`]?.orderedCardRefs??[])
    .filter(ref=>s.cards[ref]!.templateId.startsWith("statue.")&&!s.cards[ref]!.templateId.startsWith("statue.paladin."))
    .map(cardRef=>({offerId:`offer:statue-play:${cardRef}`,cardRef}));
}
type StatueCommand={commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;cardRef:string};
type StatueResult={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
export class StatuePlaySession {
  #state:AuthoritativeGameState;
  #results=new Map<string,StatueResult>();
  constructor(s:AuthoritativeGameState,private ruleset:LoadedRuleset,private deadline:number=Date.now()){this.#state=s}
  get state(){return this.#state}
  handle(c:StatueCommand,deadlineAt=this.deadline):StatueResult{
    const old=this.#results.get(c.commandId);if(old)return structuredClone(old);
    const reject=(reasonCode:string,refreshRequired:boolean):StatueResult=>({accepted:false,commandId:c.commandId,stateRevision:this.#state.stateRevision,reasonCode,refreshRequired});
    if(c.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);
    if(c.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);
    const actor=this.#state.players.find(x=>x.userId===c.actorUserId),window=actor?this.#state.pendingWindows.find(x=>x.promptId===c.promptId&&x.prioritySeat===actor.seat):undefined,
      offer=actor?buildStatuePlayOffers(this.#state,actor.seat).find(x=>x.offerId===c.offerId&&x.cardRef===c.cardRef):undefined;
    if(!actor||!window)return reject("NOT_YOUR_PRIORITY",false);if(!offer)return reject("OFFER_EXPIRED",true);
    const tx=new EngineTransaction(this.#state);tx.draft.pendingWindows=tx.draft.pendingWindows.filter(x=>x.promptId!==window.promptId);
    moveCardInTransaction(tx,{cardRef:c.cardRef,toZoneRef:"resolving",moveKind:"use",faceUp:true});
    const card=tx.draft.cards[c.cardRef]!;card.runtime.statueOwnerSeat=actor.seat;card.runtime.statueResumePlayDeadlineAt=window.deadlineAt;
    tx.emit("card.played",{seat:actor.seat,cardRef:c.cardRef,cardId:card.templateId,category:"statue"});
    tx.emit("card.effect.before",{seat:actor.seat,cardRef:c.cardRef,cardId:card.templateId,category:"statue"});
    const paid=tx.commit();paid.state.history.domainEvents.push(...paid.events);validateAuthoritativeState(paid.state);
    // 预生成效果解析报价（此时无窗口），供判定完成后继续
    const resolutionOffers=buildStatueResolutionOffers(paid.state,this.ruleset,actor.seat,c.cardRef);
    if(resolutionOffers.length)paid.state.cards[c.cardRef]!.runtime.pendingStatueResolutionOffers=resolutionOffers as unknown as JsonValue;
    const judgment=beginStatueDoubleTrigger(paid.state,this.ruleset,actor.seat,c.cardRef,deadlineAt);
    let state=judgment?.state??paid.state,events=[...paid.events,...(judgment?.events??[])];
    // 无双触判定：需要选择（目标/模式）的雕像打开效果解析窗口；无需选择的自动结算
    if(!judgment&&resolutionOffers.length){
      const needsChoice=resolutionOffers.some(o=>o.targetRef!==undefined||o.modeId!==undefined);
      if(needsChoice){
        const opened=openStatueResolutionWindow(state,c.cardRef,actor.seat,deadlineAt,resolutionOffers);
        if(opened){state=opened.state;events.push(...opened.events);}
      }else{
        const auto=beginStatueResolution(state,this.ruleset,c.cardRef,{deadlineAt});
        state=auto.state;events.push(...auto.events);
      }
    }
    this.#state=state;const result:StatueResult={accepted:true,commandId:c.commandId,previousRevision:paid.previousRevision,stateRevision:state.stateRevision,events};this.#results.set(c.commandId,result);return structuredClone(result);
  }
}
export function openStatueResolutionWindow(s:AuthoritativeGameState,statueRef:string,seat:Seat,deadlineAt:number,offers:ReturnType<typeof buildStatueResolutionOffers>){const needsChoice=offers.some(o=>o.targetRef!==undefined||o.modeId!==undefined);if(!offers.length||!needsChoice)return false;const tx=new EngineTransaction(s),promptId=`prompt:statueResolutionChoice:${tx.draft.stateRevision+1}`;const targetRefs=[...new Set(offers.map(o=>o.targetRef).filter((x):x is string=>typeof x==="string"))],modeOptions=[...new Set(offers.map(o=>o.modeId).filter((x):x is string=>typeof x==="string"))];tx.draft.pendingWindows.push({promptId,kind:"statueResolutionChoice",prioritySeat:seat,mandatory:true,deadlineAt,timeoutPolicy:"randomLegal",legalOfferIds:offers.map(o=>o.offerId),context:{statueRef,offers:offers as unknown as JsonValue,legalTargetRefs:targetRefs,modeOptions}});tx.emit("choice.requested",{kind:"statueResolutionChoice",promptId,seat,legalTargetRefs:targetRefs});const out=tx.commit();out.state.history.domainEvents.push(...out.events);validateAuthoritativeState(out.state);return out;}
export function openStatueResolutionFromJudgment(tx:EngineTransaction<AuthoritativeGameState>,statueRef:string){const card=tx.draft.cards[statueRef],offers=card?.runtime.pendingStatueResolutionOffers;if(!card||!Array.isArray(offers)||!offers.length||tx.draft.pendingWindows.some(w=>w.kind==="statueResolutionChoice"))return;const needsChoice=(offers as Array<Record<string,JsonValue>>).some(o=>o.targetRef!==undefined||o.modeId!==undefined);if(!needsChoice){card.runtime.autoResolveStatueAfterJudgment=true;return;}const owner=Number(card.runtime.statueOwnerSeat??card.controllerSeat) as Seat,deadline=Number(card.runtime.statueResumePlayDeadlineAt??0),promptId=`prompt:statueResolutionChoice:${tx.draft.stateRevision+1}`;const targetRefs=[...new Set(offers.map(o=>(o as Record<string,JsonValue>).targetRef).filter((x):x is string=>typeof x==="string"))],modeOptions=[...new Set(offers.map(o=>(o as Record<string,JsonValue>).modeId).filter((x):x is string=>typeof x==="string"))];tx.draft.pendingWindows.push({promptId,kind:"statueResolutionChoice",prioritySeat:owner,mandatory:true,deadlineAt:deadline,timeoutPolicy:"randomLegal",legalOfferIds:offers.map(o=>String((o as Record<string,JsonValue>).offerId)),context:{statueRef,offers,legalTargetRefs:targetRefs,modeOptions}});tx.emit("choice.requested",{kind:"statueResolutionChoice",promptId,seat:owner,legalTargetRefs:targetRefs});}
export function beginStatueDoubleTrigger(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
  statueRef: string,
  deadlineAt: number,
) {
  const card = s.cards[statueRef];
  if (!card?.templateId.startsWith("statue.") || !active(s, seat)) return null;
  const input = {
    controllerSeat: seat,
    sourceRef: `character:${seat}`,
    purpose: "statueDoubleTrigger",
    matchColors: ["blue"] as import("./judgment.js").PrintedColor[],
    context: { statueDoubleTrigger: true, statueRef, ownerSeat: seat },
  };
  return (
    openPreJudgmentWindow(s, r, input, deadlineAt) ??
    beginJudgment(s, r, input, deadlineAt)
  );
}
export function completeStatueResolution(
  s: AuthoritativeGameState,
  statueRef: string,
) {
  const card = s.cards[statueRef];
  if (!card) return null;
  const tx = new EngineTransaction(s);
  const ownerSeat=Number(card.runtime.statueOwnerSeat??card.ownerSeat??card.controllerSeat) as Seat,
    resumeDeadline=Number(card.runtime.statueResumePlayDeadlineAt??0);
  if (card.runtime.returnAfterStatue === true && card.zoneRef === "resolving") {
    delete tx.draft.cards[statueRef]!.runtime.returnAfterStatue;
    moveCardInTransaction(tx, {
      cardRef: statueRef,
      toZoneRef: `hand:${ownerSeat}`,
      moveKind: "return",
      faceUp: false,
    });
    tx.emit("talent.statueDoubleTrigger.returned", { statueRef });
  } else if (card.zoneRef === "resolving")
    moveCardInTransaction(tx, {
      cardRef: statueRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
  delete tx.draft.cards[statueRef]!.runtime.statueOwnerSeat;
  delete tx.draft.cards[statueRef]!.runtime.statueResumePlayDeadlineAt;
  if(resumeDeadline>0&&!tx.draft.pendingWindows.length&&tx.draft.activeSeat===ownerSeat&&tx.draft.phase==="play"){
    const promptId=`prompt:playPhaseAction:${tx.draft.round}:${ownerSeat}:${tx.draft.stateRevision+1}`;
    tx.draft.pendingWindows.push({promptId,kind:"playPhaseAction",prioritySeat:ownerSeat,mandatory:false,deadlineAt:resumeDeadline,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}});
    tx.emit("choice.requested",{seat:ownerSeat,kind:"playPhaseAction",resumedAfterStatue:true});
  }
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}
export function finishStatueEffectFlow(
  s: AuthoritativeGameState,
  statueRef: string,
  effectInvalidated: boolean,
) {
  const card=s.cards[statueRef];
  if(!card||card.zoneRef!=="resolving")return null;
  const tx=new EngineTransaction(s);
  tx.emit(effectInvalidated?"card.effect.prevented":"card.effect.resolved",{
    cardRef:statueRef,
    cardId:card.templateId,
    category:"statue",
    reason:effectInvalidated?"statueResponse":null,
  });
  const effectFinished=tx.commit();
  effectFinished.state.history.domainEvents.push(...effectFinished.events);
  const exited=completeStatueResolution(effectFinished.state,statueRef)!;
  return {
    previousRevision:effectFinished.previousRevision,
    state:exited.state,
    events:[...effectFinished.events,...exited.events],
  };
}
