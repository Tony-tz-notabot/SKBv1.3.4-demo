import type { LoadedRuleset } from "../ruleset/types.js";
import { EngineTransaction } from "./transaction.js";
import type { TransactionCommit } from "./types.js";
import { handCards, handZoneRef, type AuthoritativeGameState, type CardInstanceState, type RedrawState, type Seat, type ZoneState } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import {createRandomSource,shuffleWithSource} from "./random.js";
export type { RedrawState, Seat } from "./state.js";

interface DeckEntry { cardId: string; count: number }
interface DeckDocument { totalCount: number; entries: DeckEntry[] }

export interface CreateSetupInput { gameId: string; firstSeat: Seat; seed: number; usersBySeat: Record<Seat, string>; characterIdsBySeat:Record<Seat,string>; setupStartedAt?: number }

function seatOrder(firstSeat: Seat): Seat[] {
  return [0, 1, 2, 3].map((offset) => (((firstSeat - 1 + offset) % 4) + 1) as Seat);
}

function draw(state: AuthoritativeGameState, seat: Seat, count: number): string[] {
  const drawPile=state.zones.drawPile!.orderedCardRefs;
  if (drawPile.length < count) throw new Error("SETUP_DRAW_PILE_EXHAUSTED");
  const cards = drawPile.splice(0, count);
  state.zones[handZoneRef(seat)]!.orderedCardRefs.push(...cards);
  for (const cardRef of cards) {
    const card = state.cards[cardRef]!;
    card.zoneRef = `hand:${seat}`;
    card.ownerSeat = seat;
    card.controllerSeat = seat;
  }
  return cards;
}

export function createInitialSetup(ruleset: LoadedRuleset, input: CreateSetupInput): AuthoritativeGameState {
  const deck = ruleset.documents.get("deck.json") as DeckDocument;
  const characters=new Map((ruleset.documents.get("characters.json") as {items:Array<{characterId:string;maxHp:number;maxShield:number;initialTalentIds:string[];skillIds:string[]}>}).items.map(character=>[character.characterId,character]));
  const cards: Record<string, CardInstanceState> = {};
  const orderedRefs: string[] = [];
  let serial = 1;
  for (const entry of deck.entries) {
    for (let copy = 0; copy < entry.count; copy += 1) {
      const cardRef = `card:${String(serial).padStart(4, "0")}`;
      serial += 1;
      orderedRefs.push(cardRef);
      cards[cardRef] = { cardRef, templateId: entry.cardId, zoneRef: "drawPile", ownerSeat: null, controllerSeat: null, faceUp: false, runtime: {} };
    }
  }
  if (orderedRefs.length !== deck.totalCount) throw new Error("DECK_INSTANCE_COUNT_MISMATCH");
  const shuffled=shuffleWithSource(orderedRefs,createRandomSource(input.seed));const drawPile=shuffled.value;
  const deadline=(input.setupStartedAt??0)+ruleset.settings.setup.redraw.timeoutMs;
  const redrawBySeat:Record<Seat,RedrawState>={1:{decided:false,used:false},2:{decided:false,used:false},3:{decided:false,used:false},4:{decided:false,used:false}};
  const zones:Record<string,ZoneState>={drawPile:{zoneRef:"drawPile",zoneType:"drawPile",ownerSeat:null,orderedCardRefs:drawPile},discardPile:{zoneRef:"discardPile",zoneType:"discardPile",ownerSeat:null,orderedCardRefs:[]},resolving:{zoneRef:"resolving",zoneType:"resolving",ownerSeat:null,orderedCardRefs:[]},outsideDeck:{zoneRef:"outsideDeck",zoneType:"outsideDeck",ownerSeat:null,orderedCardRefs:[]},removedFromGame:{zoneRef:"removedFromGame",zoneType:"removedFromGame",ownerSeat:null,orderedCardRefs:[]}};
  for(const seat of [1,2,3,4] as Seat[]){zones[handZoneRef(seat)]={zoneRef:handZoneRef(seat),zoneType:"hand",ownerSeat:seat,orderedCardRefs:[]};for(const [suffix,type] of [["judgment","judgment"],["weapon:1","weaponSlot"],["weapon:2","weaponSlot"],["weapon:3","weaponSlot"],["thirdWeapon","thirdWeaponSlot"],["armor","armorSlot"],["mountOffense","mountOffenseSlot"],["mountDefense","mountDefenseSlot"],["talent","talentZone"],["boss","bossSlot"]] as const){const zoneRef=`${suffix}:${seat}`;zones[zoneRef]={zoneRef,zoneType:type,ownerSeat:seat,orderedCardRefs:[]};}}
  const state:AuthoritativeGameState={kind:"AUTHORITATIVE_GAME_STATE",gameId:input.gameId,rulesetVersion:ruleset.manifest.version,stateRevision:0,lastEventSeq:0,lifecycle:"setupRedraw",setup:{firstSeat:input.firstSeat,redrawDeadlineAt:deadline,redrawBySeat},round:0,activeSeat:null,phase:null,phaseBoundary:null,phaseMode:null,phaseBodyResolved:null,winnerTeam:null,players:([1,2,3,4] as Seat[]).map(seat=>{const character=characters.get(input.characterIdsBySeat[seat]);if(!character)throw new Error(`CHARACTER_NOT_FOUND:${input.characterIdsBySeat[seat]}`);return{seat,userId:input.usersBySeat[seat],team:ruleset.settings.teamsBySeat[String(seat)]!,characterId:character.characterId,presence:"inPlay",lifeState:"alive",hp:character.maxHp,maxHp:character.maxHp,shield:character.maxShield,maxShield:character.maxShield,ironShield:0,initialTalentIds:[...character.initialTalentIds],skillIds:[...character.skillIds],statuses:[],markers:{healthFloor:character.characterId==="character.interdimensional_traveler"?3:-1,...(character.skillIds.includes("skill.punching_bag.extra_health")?{"punchingBag.extraHp":12}:{})},limits:{}};}),cards,zones,pendingWindows:([1,2,3,4] as Seat[]).map(seat=>({promptId:`prompt:setup-redraw:${seat}`,kind:"initialRedraw",prioritySeat:seat,mandatory:false,deadlineAt:deadline,timeoutPolicy:"pass",legalOfferIds:[`offer:setup-redraw:${seat}`]})),resolutionStack:[],combat:{attack:null,targetQueue:[],currentTargetRef:null,responseStack:[],damageSegment:null,dyingStack:[]},durations:[],scheduledEffects:[],randomHistory:[{randomSeq:1,purpose:"game.setup.shuffle",candidateRefs:orderedRefs,resultRefs:[...drawPile]}],randomSource:shuffled.source,preselection:{1:{weaponSlot:null,modeId:null},2:{weaponSlot:null,modeId:null},3:{weaponSlot:null,modeId:null},4:{weaponSlot:null,modeId:null}},history:{domainEvents:[]}};
  for (const seat of seatOrder(input.firstSeat)) draw(state, seat, ruleset.settings.setup.initialHandCount);
  return validateAuthoritativeState(state);
}

export function resolveInitialRedraw(state: AuthoritativeGameState, seat: Seat, redraw: boolean, ruleset: LoadedRuleset): TransactionCommit<AuthoritativeGameState> {
  if (state.lifecycle !== "setupRedraw") throw new Error("REDRAW_WINDOW_CLOSED");
  if (!state.setup || state.setup.redrawBySeat[seat].decided) throw new Error("REDRAW_ALREADY_DECIDED");
  const transaction = new EngineTransaction(state);
  const draft = transaction.draft;
  if (redraw) {
    const original = draft.zones[handZoneRef(seat)]!.orderedCardRefs.splice(0);
    if (ruleset.settings.setup.redraw.discardAll && original.length !== ruleset.settings.setup.initialHandCount) throw new Error("REDRAW_HAND_SIZE_INVALID");
    for (const cardRef of original) {
      const card = draft.cards[cardRef]!;
      card.zoneRef = "discardPile"; card.ownerSeat = null; card.controllerSeat = null; card.faceUp = true;
    }
    draft.zones.discardPile!.orderedCardRefs.push(...original);
    const replacements = draw(draft, seat, ruleset.settings.setup.redraw.drawCount);
    draft.setup!.redrawBySeat[seat] = { decided: true, used: true };
    transaction.emit("card.discarded", { reason: "initialRedraw", seat, cardRefs: original });
    transaction.emit("card.drawn", { reason: "initialRedraw", seat, cardRefs: replacements });
  } else {
    draft.setup!.redrawBySeat[seat] = { decided: true, used: false };
    transaction.emit("choice.passed", { choice: "initialRedraw", seat });
  }
  draft.pendingWindows=draft.pendingWindows.filter(window=>window.prioritySeat!==seat||window.kind!=="initialRedraw");
  if ((Object.values(draft.setup!.redrawBySeat) as RedrawState[]).every((entry) => entry.decided)) {
    draft.lifecycle = "inProgress";
    draft.round=1;draft.activeSeat=draft.setup!.firstSeat;draft.phase="prepare";draft.phaseBoundary="body";draft.phaseMode="automatic";draft.phaseBodyResolved=false;
    transaction.emit("game.start", { firstSeat: draft.setup!.firstSeat });
    transaction.emit("turn.before",{seat:draft.activeSeat,round:draft.round});transaction.emit("turn.start",{seat:draft.activeSeat,round:draft.round});
    transaction.emit("phase.before",{seat:draft.activeSeat,phase:"prepare"});transaction.emit("phase.start",{seat:draft.activeSeat,phase:"prepare"});transaction.emit("phase.body",{seat:draft.activeSeat,phase:"prepare",mode:"automatic"});
  }
  const committed=transaction.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);return committed;
}
