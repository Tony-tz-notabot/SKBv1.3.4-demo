import {shuffleWithSource} from "./random.js";
import {handCards,handZoneRef,type AuthoritativeGameState,type PendingWindowState,type Seat} from "./state.js";
import {validateAuthoritativeState} from "./stateValidation.js";
import {EngineTransaction} from "./transaction.js";
import type {DomainEvent} from "./types.js";

export interface PhaseCommand {commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;cardRefs?:string[]}
export type PhaseCommandRejectionCode="GAME_NOT_FOUND"|"STALE_REVISION"|"PROMPT_CLOSED"|"OFFER_EXPIRED"|"NOT_YOUR_PRIORITY"|"INVALID_SELECTION";
export interface AcceptedPhaseCommandResult {accepted:true;commandId:string;previousRevision:number;stateRevision:number;firstEventSeq:number|null;events:DomainEvent[]}
export interface RejectedPhaseCommandResult {accepted:false;commandId:string;stateRevision:number;reasonCode:PhaseCommandRejectionCode;messageKey:string;refreshRequired:boolean}
export type PhaseCommandResult=AcceptedPhaseCommandResult|RejectedPhaseCommandResult;

const seatForUser=(state:AuthoritativeGameState,userId:string):Seat|null=>state.players.find(player=>player.userId===userId)?.seat??null;
const activeWindow=(state:AuthoritativeGameState):PendingWindowState|undefined=>state.pendingWindows.find(window=>window.prioritySeat===state.activeSeat&&(window.kind==="playPhaseAction"||window.kind==="discardPhaseAction"));

function resolveWindow(state:AuthoritativeGameState,window:PendingWindowState,cardRefs:string[]):{state:AuthoritativeGameState;previousRevision:number;events:DomainEvent[]}{
  const tx=new EngineTransaction(state),draft=tx.draft,seat=draft.activeSeat!;
  if(window.kind==="discardPhaseAction"){
    const requiredCount=window.context?.requiredCount,legalCardRefs=window.context?.legalCardRefs;
    if(typeof requiredCount!=="number"||!Array.isArray(legalCardRefs))throw new Error("DISCARD_OFFER_CONTEXT_INVALID");
    const selected=new Set(cardRefs),legal=new Set(legalCardRefs.filter((ref):ref is string=>typeof ref==="string"));
    if(selected.size!==cardRefs.length||cardRefs.length!==requiredCount||cardRefs.some(ref=>!legal.has(ref)||!handCards(draft,seat).includes(ref)))throw new Error("INVALID_SELECTION");
    for(const cardRef of cardRefs){const hand=draft.zones[handZoneRef(seat)]!,index=hand.orderedCardRefs.indexOf(cardRef);hand.orderedCardRefs.splice(index,1);draft.zones.discardPile!.orderedCardRefs.push(cardRef);const card=draft.cards[cardRef]!;card.zoneRef="discardPile";card.ownerSeat=null;card.controllerSeat=null;card.faceUp=true;tx.emit("card.discarded",{seat,cardRef,reason:"handLimit"});}
  }else if(cardRefs.length)throw new Error("INVALID_SELECTION");
  draft.pendingWindows=draft.pendingWindows.filter(item=>item.promptId!==window.promptId);draft.phaseBodyResolved=true;tx.emit("choice.resolved",{seat,kind:window.kind,result:window.kind==="playPhaseAction"?"finish":"submitted",cardRefs});
  const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);return committed;
}

export class PhaseCommandSession{
  #state:AuthoritativeGameState;readonly #results=new Map<string,PhaseCommandResult>();
  constructor(state:AuthoritativeGameState){this.#state=state;}get state(){return this.#state;}
  handle(command:PhaseCommand):PhaseCommandResult{const prior=this.#results.get(command.commandId);if(prior)return structuredClone(prior);const reject=(reasonCode:PhaseCommandRejectionCode,refreshRequired:boolean):RejectedPhaseCommandResult=>{const result={accepted:false as const,commandId:command.commandId,stateRevision:this.#state.stateRevision,reasonCode,messageKey:`command.${reasonCode.toLowerCase()}`,refreshRequired};this.#results.set(command.commandId,result);return structuredClone(result);};if(command.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);if(command.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);const window=activeWindow(this.#state);if(!window)return reject("PROMPT_CLOSED",true);const seat=seatForUser(this.#state,command.actorUserId);if(seat!==window.prioritySeat)return reject("NOT_YOUR_PRIORITY",false);if(command.promptId!==window.promptId||!window.legalOfferIds.includes(command.offerId))return reject("OFFER_EXPIRED",true);let committed;try{committed=resolveWindow(this.#state,window,command.cardRefs??[]);}catch(error){if(error instanceof Error&&error.message==="INVALID_SELECTION")return reject("INVALID_SELECTION",false);throw error;}this.#state=committed.state;const result:AcceptedPhaseCommandResult={accepted:true,commandId:command.commandId,previousRevision:committed.previousRevision,stateRevision:committed.state.stateRevision,firstEventSeq:committed.events[0]?.eventSeq??null,events:committed.events};this.#results.set(command.commandId,result);return structuredClone(result);}
  handleTimeout(commandId:string):PhaseCommandResult{const window=activeWindow(this.#state);if(!window)return{accepted:false,commandId,stateRevision:this.#state.stateRevision,reasonCode:"PROMPT_CLOSED",messageKey:"command.prompt_closed",refreshRequired:true};let cardRefs:string[]=[];if(window.kind==="discardPhaseAction"){const count=Number(window.context?.requiredCount??0),candidates=handCards(this.#state,window.prioritySeat);const randomSeq=this.#state.randomSource.nextRandomSeq,shuffled=shuffleWithSource(candidates,this.#state.randomSource);this.#state.randomSource=shuffled.source;cardRefs=shuffled.value.slice(0,count);this.#state.randomHistory.push({randomSeq,purpose:"timeout.discard",candidateRefs:[...candidates],resultRefs:[...cardRefs]});}return this.handle({commandId,gameId:this.#state.gameId,expectedStateRevision:this.#state.stateRevision,actorUserId:this.#state.players.find(player=>player.seat===window.prioritySeat)!.userId,promptId:window.promptId,offerId:window.legalOfferIds[0]!,cardRefs});}
}
