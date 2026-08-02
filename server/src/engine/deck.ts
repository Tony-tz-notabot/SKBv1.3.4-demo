import {shuffleWithSource} from "./random.js";
import {handZoneRef,type AuthoritativeGameState,type Seat} from "./state.js";
import {validateAuthoritativeState} from "./stateValidation.js";
import {EngineTransaction} from "./transaction.js";
import type {TransactionCommit} from "./types.js";

export interface DrawCardsResult { requestedCount:number; actualCount:number; cardRefs:string[] }

export function takeTopCardsToResolvingInTransaction(tx:EngineTransaction<AuthoritativeGameState>,count:number,reason:string):DrawCardsResult {
  if(!Number.isInteger(count))throw new Error("DRAW_COUNT_NOT_INTEGER");
  const requestedCount=Math.max(0,count),draft=tx.draft,cardRefs:string[]=[];
  while(cardRefs.length<requestedCount){
    const drawPile=draft.zones.drawPile!;
    if(drawPile.orderedCardRefs.length===0&&!ensureDrawPileInTransaction(tx,reason,{requestedCount,drawnCount:cardRefs.length}))break;
    const cardRef=drawPile.orderedCardRefs.shift();if(cardRef)cardRefs.push(cardRef);
  }
  draft.zones.resolving!.orderedCardRefs.push(...cardRefs);
  for(const cardRef of cardRefs){const card=draft.cards[cardRef]!;card.zoneRef="resolving";card.ownerSeat=null;card.controllerSeat=null;card.faceUp=false;}
  return{requestedCount,actualCount:cardRefs.length,cardRefs};
}

export function ensureDrawPileInTransaction(tx:EngineTransaction<AuthoritativeGameState>,reason:string,context:Record<string,string|number>={}):boolean{
  const draft=tx.draft,drawPile=draft.zones.drawPile!;if(drawPile.orderedCardRefs.length)return true;const discardPile=draft.zones.discardPile!;tx.emit("deck.exhausted",{reason,...context});if(discardPile.orderedCardRefs.length===0)return false;const candidateRefs=discardPile.orderedCardRefs.splice(0),randomSeq=draft.randomSource.nextRandomSeq,shuffled=shuffleWithSource(candidateRefs,draft.randomSource);draft.randomSource=shuffled.source;drawPile.orderedCardRefs.push(...shuffled.value);for(const cardRef of shuffled.value){const card=draft.cards[cardRef]!;card.zoneRef="drawPile";card.ownerSeat=null;card.controllerSeat=null;card.faceUp=false;}draft.randomHistory.push({randomSeq,purpose:"deck.reshuffle",candidateRefs,resultRefs:[...shuffled.value]});tx.emit("deck.reshuffled",{randomSeq,count:shuffled.value.length,reason});return true;
}

export function drawCardsInTransaction(tx:EngineTransaction<AuthoritativeGameState>,seat:Seat,count:number,reason:string):DrawCardsResult {
  if(!Number.isInteger(count))throw new Error("DRAW_COUNT_NOT_INTEGER");
  const requestedCount=Math.max(0,count),draft=tx.draft,cardRefs:string[]=[];
  while(cardRefs.length<requestedCount){
    const drawPile=draft.zones.drawPile!;
    if(drawPile.orderedCardRefs.length===0&&!ensureDrawPileInTransaction(tx,reason,{requestedCount,drawnCount:cardRefs.length}))break;
    const cardRef=drawPile.orderedCardRefs.shift();
    if(cardRef)cardRefs.push(cardRef);
  }
  const handRef=handZoneRef(seat);
  draft.zones[handRef]!.orderedCardRefs.push(...cardRefs);
  for(const cardRef of cardRefs){const card=draft.cards[cardRef]!;card.zoneRef=handRef;card.ownerSeat=seat;card.controllerSeat=seat;card.faceUp=false;}
  tx.emit("card.drawn",{seat,cardRefs,requestedCount,actualCount:cardRefs.length,reason});
  return{requestedCount,actualCount:cardRefs.length,cardRefs};
}

export function drawCards(state:AuthoritativeGameState,seat:Seat,count:number,reason="effect.draw"):TransactionCommit<AuthoritativeGameState>{
  const tx=new EngineTransaction(state);drawCardsInTransaction(tx,seat,count,reason);const committed=tx.commit();
  committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);return committed;
}
