import type { LoadedRuleset } from "../ruleset/types.js";
import { clearBerserkerDrawResolution } from "./berserkerRage.js";
import { takeTopCardsToResolvingInTransaction } from "./deck.js";
import { consumeDrawCountModifiersAtDrawBoundary } from "./drawCount.js";
import { shuffleWithSource } from "./random.js";
import { handZoneRef, type AuthoritativeGameState, type Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

interface CharacterRule { ruleId:string; effects:Array<{op:string;params?:Record<string,unknown>}> }
interface CharacterDocument { rules:CharacterRule[] }
function validateRule(ruleset:LoadedRuleset):void {
  const document=ruleset.documents.get("character-rules.json") as CharacterDocument,
    rule=document.rules.find(item=>item.ruleId==="character.shaman.foresight"),
    replacement=rule?.effects.find(effect=>effect.op==="replaceEvent")?.params;
  if(replacement?.with!=="display N+2 choose N"||replacement.remaining!=="discardPile"||replacement.skipCreatesNothing!==true)throw new Error("FORESIGHT_RULE_INVALID");
}
function eligible(state:AuthoritativeGameState,seat:Seat):boolean {
  const owner=state.players.find(item=>item.seat===seat);
  return owner?.characterId==="character.shaman"&&owner.initialTalentIds.includes("talent.foresight")&&owner.lifeState!=="eliminated";
}
export function openForesightDrawWindow(tx:EngineTransaction<AuthoritativeGameState>,ruleset:LoadedRuleset,seat:Seat,drawCount:number,deadlineAt:number):boolean {
  if(!eligible(tx.draft,seat))return false;validateRule(ruleset);
  const shown=takeTopCardsToResolvingInTransaction(tx,drawCount+2,"talent.foresight"),requiredCount=Math.min(drawCount,shown.actualCount),promptId=`prompt:foresight:${tx.draft.round}:${seat}:${tx.draft.stateRevision+1}`;
  tx.draft.pendingWindows.push({promptId,kind:"foresightDrawChoice",prioritySeat:seat,mandatory:true,deadlineAt,timeoutPolicy:"randomLegal",legalOfferIds:["offer:foresight:submit"],context:{cardRefs:shown.cardRefs,requestedDrawCount:drawCount,requiredCount}});
  tx.emit("cards.displayed",{seat,cardRefs:shown.cardRefs,requestedCount:drawCount+2,actualCount:shown.actualCount,reason:"talent.foresight",visibility:"private"});
  tx.emit("choice.requested",{kind:"foresightDrawChoice",seat,promptId,cardRefs:shown.cardRefs,requiredCount,visibility:"private"});
  return true;
}
export interface ForesightCommand {commandId:string;gameId:string;expectedStateRevision:number;actorUserId:string;promptId:string;offerId:string;cardRefs:string[]}
export type ForesightResult={accepted:true;commandId:string;previousRevision:number;stateRevision:number;events:DomainEvent[]}|{accepted:false;commandId:string;stateRevision:number;reasonCode:string;refreshRequired:boolean};
export class ForesightSession {
  #state:AuthoritativeGameState;readonly #results=new Map<string,ForesightResult>();
  constructor(state:AuthoritativeGameState){this.#state=state;}get state(){return this.#state;}
  handle(command:ForesightCommand):ForesightResult {
    const prior=this.#results.get(command.commandId);if(prior)return structuredClone(prior);
    const reject=(reasonCode:string,refreshRequired:boolean):ForesightResult=>{const result={accepted:false as const,commandId:command.commandId,stateRevision:this.#state.stateRevision,reasonCode,refreshRequired};this.#results.set(command.commandId,result);return structuredClone(result);};
    if(command.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);if(command.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);
    const window=this.#state.pendingWindows.find(item=>item.kind==="foresightDrawChoice"),actor=this.#state.players.find(item=>item.userId===command.actorUserId);
    if(!window||window.promptId!==command.promptId)return reject("PROMPT_CLOSED",true);if(!actor||actor.seat!==window.prioritySeat)return reject("NOT_YOUR_PRIORITY",false);if(command.offerId!=="offer:foresight:submit"||!window.legalOfferIds.includes(command.offerId))return reject("OFFER_EXPIRED",true);
    const shown=(window.context?.cardRefs as string[]|undefined)??[],required=Number(window.context?.requiredCount??-1),chosen=command.cardRefs;
    if(!Number.isInteger(required)||chosen.length!==required||new Set(chosen).size!==chosen.length||chosen.some(ref=>!shown.includes(ref))||shown.some(ref=>this.#state.cards[ref]?.zoneRef!=="resolving"))return reject("FORESIGHT_SELECTION_INVALID",false);
    const tx=new EngineTransaction(this.#state),draft=tx.draft,hand=draft.zones[handZoneRef(actor.seat)]!,discard=draft.zones.discardPile!,resolving=draft.zones.resolving!,chosenSet=new Set(chosen),unselected=shown.filter(ref=>!chosenSet.has(ref));
    draft.pendingWindows=draft.pendingWindows.filter(item=>item.promptId!==window.promptId);
    for(const ref of shown){const index=resolving.orderedCardRefs.indexOf(ref);if(index<0)throw new Error("FORESIGHT_CARD_MOVED");resolving.orderedCardRefs.splice(index,1);const card=draft.cards[ref]!;if(chosenSet.has(ref)){hand.orderedCardRefs.push(ref);card.zoneRef=hand.zoneRef;card.ownerSeat=actor.seat;card.controllerSeat=actor.seat;card.faceUp=false;}else{discard.orderedCardRefs.push(ref);card.zoneRef="discardPile";card.ownerSeat=null;card.controllerSeat=null;card.faceUp=true;tx.emit("card.discarded",{seat:actor.seat,cardRef:ref,reason:"talent.foresight.unselected"});}}
    tx.emit("card.drawn",{seat:actor.seat,cardRefs:chosen,requestedCount:Number(window.context?.requestedDrawCount??required),actualCount:chosen.length,reason:"talent.foresight"});
    consumeDrawCountModifiersAtDrawBoundary(tx,actor.seat,"resolved");clearBerserkerDrawResolution(tx,actor.seat);draft.phaseBodyResolved=true;
    tx.emit("choice.resolved",{kind:"foresightDrawChoice",seat:actor.seat,chosenCardRefs:chosen,discardedCardRefs:unselected});
    const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);this.#state=committed.state;
    const result={accepted:true as const,commandId:command.commandId,previousRevision:committed.previousRevision,stateRevision:committed.state.stateRevision,events:committed.events};this.#results.set(command.commandId,result);return structuredClone(result);
  }
  handleTimeout(commandId:string):ForesightResult {
    const window=this.#state.pendingWindows.find(item=>item.kind==="foresightDrawChoice");if(!window)return{accepted:false,commandId,stateRevision:this.#state.stateRevision,reasonCode:"PROMPT_CLOSED",refreshRequired:true};
    const candidates=[...((window.context?.cardRefs as string[]|undefined)??[])],count=Number(window.context?.requiredCount??0),randomSeq=this.#state.randomSource.nextRandomSeq,shuffled=shuffleWithSource(candidates,this.#state.randomSource);this.#state.randomSource=shuffled.source;const selected=shuffled.value.slice(0,count);this.#state.randomHistory.push({randomSeq,purpose:"timeout.foresight",candidateRefs:candidates,resultRefs:selected});
    return this.handle({commandId,gameId:this.#state.gameId,expectedStateRevision:this.#state.stateRevision,actorUserId:this.#state.players.find(item=>item.seat===window.prioritySeat)!.userId,promptId:window.promptId,offerId:"offer:foresight:submit",cardRefs:selected});
  }
}
