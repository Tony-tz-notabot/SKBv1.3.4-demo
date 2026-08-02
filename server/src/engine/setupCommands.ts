import type { LoadedRuleset } from "../ruleset/types.js";
import { resolveInitialRedraw, type Seat } from "./setup.js";
import type { DomainEvent } from "./types.js";
import { handCards, type AuthoritativeGameState } from "./state.js";

interface CardFact { cardId: string; displayName: string; category: string; color: string; resourceKey: string }
interface CardsDocument { items: CardFact[] }
export interface VisibleSetupCard { ref: string; templateId: string; displayName: string; category: string; printedColor: string; resourceKey: string }
export interface SetupInteraction {
  prompt: null | { promptId: string; kind: "initialRedraw"; mandatory: false; deadlineAt: number; prioritySeat: Seat; timeoutPolicy: "pass" };
  offers: Array<{ offerId: string; kind: "resolveChoice"; sourceRefs: string[]; legalTargetRefs: string[]; selectionSpecs: Array<{ key: "confirm"; kind: "confirm"; min: 1; max: 1; options: boolean[] }>; preview: { costSummary: string } }>;
  disabledHints: [];
}
export interface SetupSnapshot {
  type: "SETUP_SNAPSHOT"; gameId: string; rulesetVersion: string; stateRevision: number; lastEventSeq: number; serverTime: number;
  lifecycle: "setupRedraw" | "inProgress"; viewer: { userId: string | null; seat: Seat | null; team: "A" | "B" | null };
  firstSeat: Seat; drawPileCount: number; discardPile: VisibleSetupCard[];
  seats: Array<{ seat: Seat; handCount: number; redrawDecided: boolean }>;
  hand: VisibleSetupCard[]; redrawUsed: boolean | null; interaction: SetupInteraction;
}
export interface SetupProjection { audienceKey: string; protocolMessage: SetupSnapshot }
export interface RedrawOffer { promptId: string; offerId: string; kind: "resolveChoice"; mandatory: false; timeoutPolicy: "pass"; selections: { confirm: boolean[] } }
export interface SetupPresentationEvent { type: "PRESENTATION_EVENT"; eventSeq: number; stateRevision: number; eventType: "SETUP_REDRAW_RESOLVED" | "GAME_STARTED"; payload: Record<string, unknown> }

export interface RedrawCommand { commandId: string; gameId: string; expectedStateRevision: number; actorUserId: string; promptId: string; offerId: string; redraw: boolean }
export type CommandRejectionCode = "GAME_NOT_FOUND" | "STALE_REVISION" | "PROMPT_CLOSED" | "OFFER_EXPIRED" | "NOT_YOUR_PRIORITY";
export interface AcceptedCommandResult { accepted: true; commandId: string; previousRevision: number; stateRevision: number; firstEventSeq: number | null; events: DomainEvent[]; projections: SetupProjection[] }
export interface RejectedCommandResult { accepted: false; commandId: string; stateRevision: number; reasonCode: CommandRejectionCode; messageKey: string; refreshRequired: boolean }
export type SetupCommandResult = AcceptedCommandResult | RejectedCommandResult;

const promptIdFor = (seat: Seat) => `prompt:setup-redraw:${seat}`;
const offerIdFor = (seat: Seat) => `offer:setup-redraw:${seat}`;
function seatForUser(state: AuthoritativeGameState, userId: string): Seat | null { return state.players.find(player=>player.userId===userId)?.seat??null; }

export function projectRedrawOffer(state: AuthoritativeGameState, viewerUserId: string): RedrawOffer | null {
  if (state.lifecycle !== "setupRedraw"||!state.setup) return null;
  const seat=seatForUser(state,viewerUserId); if(!seat||state.setup.redrawBySeat[seat].decided)return null;
  return {promptId:promptIdFor(seat),offerId:offerIdFor(seat),kind:"resolveChoice",mandatory:false,timeoutPolicy:"pass",selections:{confirm:[true,false]}};
}

export function projectSetupView(state: AuthoritativeGameState, viewerUserId: string | null, ruleset: LoadedRuleset, serverTime=Date.now()): SetupProjection {
  if(state.lifecycle==="ended")throw new Error("SETUP_PROJECTION_UNAVAILABLE_AFTER_GAME_END");
  const seat=viewerUserId?seatForUser(state,viewerUserId):null;
  const facts=new Map((ruleset.documents.get("cards.json") as CardsDocument).items.map(card=>[card.cardId,card]));
  const visibleCard=(cardRef:string,scope:"public"|"private"):VisibleSetupCard=>{const fact=facts.get(state.cards[cardRef]!.templateId)!;return{ref:scope==="public"?`public:${cardRef}`:`private:${viewerUserId}:${cardRef}`,templateId:fact.cardId,displayName:fact.displayName,category:fact.category,printedColor:fact.color,resourceKey:fact.resourceKey};};
  const offer=viewerUserId?projectRedrawOffer(state,viewerUserId):null;
  const setup=state.setup!;
  const interaction:SetupInteraction=offer&&seat?{prompt:{promptId:offer.promptId,kind:"initialRedraw",mandatory:false,deadlineAt:setup.redrawDeadlineAt,prioritySeat:seat,timeoutPolicy:"pass"},offers:[{offerId:offer.offerId,kind:"resolveChoice",sourceRefs:[],legalTargetRefs:[],selectionSpecs:[{key:"confirm",kind:"confirm",min:1,max:1,options:[true,false]}],preview:{costSummary:`弃置全部${ruleset.settings.setup.initialHandCount}张并重摸${ruleset.settings.setup.redraw.drawCount}张`}}],disabledHints:[]}:{prompt:null,offers:[],disabledHints:[]};
  return {audienceKey:viewerUserId?`user:${viewerUserId}`:"spectators",protocolMessage:{type:"SETUP_SNAPSHOT",gameId:state.gameId,rulesetVersion:state.rulesetVersion,stateRevision:state.stateRevision,lastEventSeq:state.lastEventSeq,serverTime,lifecycle:state.lifecycle,viewer:{userId:viewerUserId,seat,team:seat?ruleset.settings.teamsBySeat[String(seat)]!:null},firstSeat:setup.firstSeat,drawPileCount:state.zones.drawPile!.orderedCardRefs.length,discardPile:state.zones.discardPile!.orderedCardRefs.map(ref=>visibleCard(ref,"public")),seats:([1,2,3,4] as Seat[]).map(target=>({seat:target,handCount:handCards(state,target).length,redrawDecided:setup.redrawBySeat[target].decided})),hand:seat?handCards(state,seat).map(ref=>visibleCard(ref,"private")):[],redrawUsed:seat?setup.redrawBySeat[seat].used:null,interaction}};
}
export function projectAllSetupViews(state:AuthoritativeGameState,ruleset:LoadedRuleset,serverTime=Date.now()):SetupProjection[]{return[...state.players.map(player=>projectSetupView(state,player.userId,ruleset,serverTime)),projectSetupView(state,null,ruleset,serverTime)];}

export function projectSetupPresentationEvents(events:readonly DomainEvent[],viewerUserId:string|null,state:AuthoritativeGameState):SetupPresentationEvent[]{
  void viewerUserId;
  const projected:SetupPresentationEvent[]=[];
  for(const event of events){const seat=Number((event.payload as Record<string,unknown>).seat) as Seat;if(event.eventType==="game.start")projected.push({type:"PRESENTATION_EVENT",eventSeq:event.eventSeq,stateRevision:event.stateRevision,eventType:"GAME_STARTED",payload:{firstSeat:state.setup!.firstSeat}});else if(event.eventType==="choice.passed")projected.push({type:"PRESENTATION_EVENT",eventSeq:event.eventSeq,stateRevision:event.stateRevision,eventType:"SETUP_REDRAW_RESOLVED",payload:{seat,redraw:false}});else if(event.eventType==="card.discarded")projected.push({type:"PRESENTATION_EVENT",eventSeq:event.eventSeq,stateRevision:event.stateRevision,eventType:"SETUP_REDRAW_RESOLVED",payload:{seat,redraw:true}});}
  return projected;
}

export class SetupCommandSession{
  #state:AuthoritativeGameState;readonly #results=new Map<string,SetupCommandResult>();
  constructor(state:AuthoritativeGameState,private readonly ruleset:LoadedRuleset,private readonly clock:()=>number=Date.now){this.#state=state;}get state(){return this.#state;}
  handle(command:RedrawCommand):SetupCommandResult{const prior=this.#results.get(command.commandId);if(prior)return structuredClone(prior);const reject=(reasonCode:CommandRejectionCode,refreshRequired:boolean):RejectedCommandResult=>{const result={accepted:false as const,commandId:command.commandId,stateRevision:this.#state.stateRevision,reasonCode,messageKey:`command.${reasonCode.toLowerCase()}`,refreshRequired};this.#results.set(command.commandId,result);return structuredClone(result);};if(command.gameId!==this.#state.gameId)return reject("GAME_NOT_FOUND",false);if(command.expectedStateRevision!==this.#state.stateRevision)return reject("STALE_REVISION",true);if(this.#state.lifecycle!=="setupRedraw"||!this.#state.setup)return reject("PROMPT_CLOSED",true);const seat=seatForUser(this.#state,command.actorUserId);if(!seat)return reject("NOT_YOUR_PRIORITY",false);if(this.#state.setup.redrawBySeat[seat].decided)return reject("PROMPT_CLOSED",true);if(command.promptId!==promptIdFor(seat)||command.offerId!==offerIdFor(seat))return reject("OFFER_EXPIRED",true);const committed=resolveInitialRedraw(this.#state,seat,command.redraw,this.ruleset);this.#state=committed.state;const result:AcceptedCommandResult={accepted:true,commandId:command.commandId,previousRevision:committed.previousRevision,stateRevision:committed.state.stateRevision,firstEventSeq:committed.events[0]?.eventSeq??null,events:committed.events,projections:projectAllSetupViews(committed.state,this.ruleset,this.clock())};this.#results.set(command.commandId,result);return structuredClone(result);}
  handleTimeout(seat:Seat,commandId:string):SetupCommandResult{return this.handle({commandId,gameId:this.#state.gameId,expectedStateRevision:this.#state.stateRevision,actorUserId:this.#state.players.find(player=>player.seat===seat)!.userId,promptId:promptIdFor(seat),offerId:offerIdFor(seat),redraw:false});}
}
