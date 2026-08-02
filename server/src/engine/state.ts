import type { DomainEvent, JsonValue } from "./types.js";
import type {RandomSourceState} from "./random.js";

export type Seat = 1 | 2 | 3 | 4;
export type Team = "A" | "B";
export type Phase = "prepare" | "judgment" | "draw" | "play" | "discard" | "end";
export type GameLifecycle = "setupRedraw" | "inProgress" | "ended";
export type PhaseBoundary="body"|"after";
export type PhaseMode="automatic"|"manual";
export type ZoneType = "drawPile" | "discardPile" | "hand" | "resolving" | "judgment" | "weaponSlot" | "thirdWeaponSlot" | "armorSlot" | "mountOffenseSlot" | "mountDefenseSlot" | "talentZone" | "bossSlot" | "outsideDeck" | "removedFromGame";

export interface CardInstanceState { cardRef:string; templateId:string; zoneRef:string; ownerSeat:Seat|null; controllerSeat:Seat|null; faceUp:boolean; runtime:Record<string,JsonValue> }
export interface ZoneState { zoneRef:string; zoneType:ZoneType; ownerSeat:Seat|null; orderedCardRefs:string[] }
export interface PlayerRuntimeState {
  seat:Seat; userId:string; team:Team; characterId:string|null; presence:"inPlay"|"leftPlay"; lifeState:"alive"|"dying"|"deadNotEliminated"|"eliminated";
  hp:number|null; maxHp:number|null; shield:number|null; maxShield:number|null; ironShield:number;
  initialTalentIds:string[]; skillIds:string[];
  statuses:StatusInstanceState[]; markers:Record<string,JsonValue>; limits:Record<string,JsonValue>;
}
export interface StatusInstanceState {statusRef:string;statusId:string;ownerSeat:Seat;sourceRef:string|null;stackPolicy:"uniqueRefresh"|"uniqueIgnore"|"stackCount"|"stackInstances"|"replaceByPriority";stacks:number;priority:number;durationId:string|null;skipPhases:Phase[];metadata:Record<string,JsonValue>}
export interface PendingWindowState { promptId:string; kind:string; prioritySeat:Seat; mandatory:boolean; deadlineAt:number; timeoutPolicy:"pass"|"randomLegal"|"useDefault"|"abortRemaining"; legalOfferIds:string[]; context?:Record<string,JsonValue> }
export interface RedrawState { decided:boolean; used:boolean }
export interface SetupLifecycleState { firstSeat:Seat; redrawDeadlineAt:number; redrawBySeat:Record<Seat,RedrawState> }
export interface RandomRecord { randomSeq:number; purpose:string; candidateRefs:string[]; resultRefs:string[] }
export interface ResolutionFrame { frameId:string; frameType:string; sourceRef:string|null; controllerSeat:Seat|null; context:Record<string,JsonValue> }
export interface DurationState { durationId:string; sourceRef:string|null; ownerRef:string; anchorEventId:string|null; activationPoint:string; expiryPoint:string; remainingCount:number|null; countScope:string; skipPolicy:string; sourceLeavePolicy:string; ownerEliminatedPolicy:string; cleanupEffects:JsonValue[] }
export interface ScheduledEffectState { scheduledId:string; sourceRef:string|null; controllerSeat:Seat|null; executeAt:string; effect:JsonValue; cancelled:boolean }
export interface CombatState { attack:JsonValue|null; targetQueue:string[]; currentTargetRef:string|null; responseStack:JsonValue[]; damageSegment:JsonValue|null; dyingStack:string[] }

export interface AuthoritativeGameState {
  kind:"AUTHORITATIVE_GAME_STATE"; gameId:string; rulesetVersion:string; stateRevision:number; lastEventSeq:number;
  lifecycle:GameLifecycle; setup:SetupLifecycleState|null; round:number; activeSeat:Seat|null; phase:Phase|null; phaseBoundary:PhaseBoundary|null; phaseMode:PhaseMode|null; phaseBodyResolved:boolean|null; winnerTeam:Team|null;
  players:PlayerRuntimeState[]; cards:Record<string,CardInstanceState>; zones:Record<string,ZoneState>;
  pendingWindows:PendingWindowState[]; resolutionStack:ResolutionFrame[]; combat:CombatState;
  durations:DurationState[]; scheduledEffects:ScheduledEffectState[]; randomHistory:RandomRecord[];
  randomSource:RandomSourceState;
  preselection:Record<Seat,{weaponSlot:string|null;modeId:string|null}>;
  history:{domainEvents:DomainEvent[]};
}

export const handZoneRef=(seat:Seat)=>`hand:${seat}`;
export const orderedCards=(state:AuthoritativeGameState,zoneRef:string)=>state.zones[zoneRef]?.orderedCardRefs??[];
export const handCards=(state:AuthoritativeGameState,seat:Seat)=>orderedCards(state,handZoneRef(seat));
