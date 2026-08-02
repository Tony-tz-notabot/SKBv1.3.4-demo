import { handZoneRef, type AuthoritativeGameState, type Seat } from "./state.js";

export class StateInvariantError extends Error { constructor(public readonly code:string){super(code);this.name="StateInvariantError";} }
const fail=(code:string):never=>{throw new StateInvariantError(code);};

export function validateAuthoritativeState(state:AuthoritativeGameState):AuthoritativeGameState{
  if(state.kind!=="AUTHORITATIVE_GAME_STATE")fail("STATE_KIND_INVALID");
  if(!state.randomSource)fail("STATE_RANDOM_SOURCE_MISSING");
  const seats=state.players.map(player=>player.seat);const users=state.players.map(player=>player.userId);
  if(state.players.length!==4||new Set(seats).size!==4||![1,2,3,4].every(seat=>seats.includes(seat as Seat)))fail("STATE_PLAYERS_INVALID");
  if(new Set(users).size!==4)fail("STATE_USERS_DUPLICATE");
  if(state.players.some(player=>!player.characterId||player.maxHp===null||player.maxShield===null))fail("STATE_CHARACTER_NOT_INITIALIZED");
  for(const player of state.players){const barsMissing=player.hp===null||player.shield===null;if(player.lifeState==="deadNotEliminated"){if(player.hp!==null||player.shield!==null)fail("STATE_DEAD_BARS_INVALID");}else if(player.lifeState==="eliminated"){if((player.hp===null)!==(player.shield===null))fail("STATE_DEAD_BARS_INVALID");}else if(barsMissing)fail("STATE_LIVING_BARS_MISSING");}
  for(const seat of [1,2,3,4] as Seat[])if(!state.zones[handZoneRef(seat)]||state.zones[handZoneRef(seat)]!.ownerSeat!==seat)fail("STATE_HAND_ZONE_INVALID");
  const seen=new Set<string>();
  for(const [zoneRef,zone] of Object.entries(state.zones)){if(zone.zoneRef!==zoneRef)fail("STATE_ZONE_REF_MISMATCH");for(const cardRef of zone.orderedCardRefs){if(seen.has(cardRef))fail("STATE_CARD_IN_MULTIPLE_ZONES");seen.add(cardRef);const card=state.cards[cardRef];if(!card)throw new StateInvariantError("STATE_ZONE_CARD_UNKNOWN");if(card.zoneRef!==zoneRef)fail("STATE_CARD_ZONE_MISMATCH");}}
  if(seen.size!==Object.keys(state.cards).length)fail("STATE_CARD_WITHOUT_ZONE");
  const prompts=state.pendingWindows.map(window=>window.promptId);if(new Set(prompts).size!==prompts.length)fail("STATE_PROMPT_DUPLICATE");
  const durationIds=state.durations.map(duration=>duration.durationId);if(new Set(durationIds).size!==durationIds.length)fail("STATE_DURATION_DUPLICATE");const allStatusRefs:string[]=[];for(const player of state.players){for(const status of player.statuses){if(status.ownerSeat!==player.seat||status.stacks<1)fail("STATE_STATUS_INVALID");allStatusRefs.push(status.statusRef);if(status.durationId&&!durationIds.includes(status.durationId))fail("STATE_STATUS_DURATION_MISSING");}const uniqueStatuses=player.statuses.filter(status=>status.stackPolicy!=="stackInstances").map(status=>status.statusId);if(new Set(uniqueStatuses).size!==uniqueStatuses.length)fail("STATE_UNIQUE_STATUS_DUPLICATE");}if(new Set(allStatusRefs).size!==allStatusRefs.length)fail("STATE_STATUS_REF_DUPLICATE");
  for(let index=0;index<state.history.domainEvents.length;index+=1){const event=state.history.domainEvents[index]!;if(index>0&&event.eventSeq!==state.history.domainEvents[index-1]!.eventSeq+1)fail("STATE_EVENT_SEQUENCE_GAP");if(event.eventSeq>state.lastEventSeq||event.stateRevision>state.stateRevision)fail("STATE_EVENT_AHEAD_OF_STATE");}
  if((state.history.domainEvents.at(-1)?.eventSeq??0)!==state.lastEventSeq)fail("STATE_LAST_EVENT_MISMATCH");
  if(state.lifecycle==="setupRedraw"){
    const setup=state.setup;if(!setup||state.round!==0||state.activeSeat!==null||state.phase!==null||state.phaseBoundary!==null||state.phaseMode!==null||state.phaseBodyResolved!==null)throw new StateInvariantError("STATE_SETUP_FLOW_INVALID");
    for(const seat of [1,2,3,4] as Seat[]){const decided=setup.redrawBySeat[seat].decided;const hasWindow=state.pendingWindows.some(window=>window.kind==="initialRedraw"&&window.prioritySeat===seat);if(decided===hasWindow)fail("STATE_REDRAW_WINDOW_MISMATCH");}
  }
  if(state.lifecycle==="inProgress"&&(state.round<1||state.activeSeat===null||state.phase===null||state.phaseBoundary===null||state.phaseMode===null||state.phaseBodyResolved===null))fail("STATE_GAME_FLOW_INVALID");
  if(state.lifecycle==="ended"&&state.winnerTeam===null)fail("STATE_ENDED_WITHOUT_WINNER");
  return state;
}
