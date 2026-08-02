import {payCostPlan,type CostPlan} from "./costs.js";
import {type AuthoritativeGameState,type Phase,type Seat} from "./state.js";
import {validateAuthoritativeState} from "./stateValidation.js";
import {calculateTargetOffer,type TargetSpec,validateTargetSelection} from "./targets.js";
import {EngineTransaction} from "./transaction.js";
import type {JsonValue,TransactionCommit} from "./types.js";

export interface ActionTargetGroup {key:string;spec:TargetSpec}
export interface ActionDefinition {actionId:string;kind:string;allowedPhases:Phase[];actorMustBeActive:boolean;targetGroups:ActionTargetGroup[];costs:CostPlan["specs"]}
export interface ActionSelections {targetsByKey:Record<string,string[]>;costs:CostPlan["selections"]}
export interface ActionExecutionInput {definition:ActionDefinition;actorSeat:Seat;selections:ActionSelections;context?:Record<string,JsonValue>}
export interface ActionResolutionContext {actionId:string;kind:string;actorSeat:Seat;targetsByKey:Record<string,string[]>;context:Record<string,JsonValue>}

export function executeAction(state:AuthoritativeGameState,input:ActionExecutionInput,resolve:(tx:EngineTransaction<AuthoritativeGameState>,context:ActionResolutionContext)=>void=()=>{}):TransactionCommit<AuthoritativeGameState>{
  const {definition,actorSeat,selections}=input;if(state.lifecycle!=="inProgress"||state.phaseBoundary!=="body"||!state.phase||!definition.allowedPhases.includes(state.phase))throw new Error("ACTION_WRONG_PHASE");if(definition.actorMustBeActive&&state.activeSeat!==actorSeat)throw new Error("ACTION_NOT_ACTIVE_ACTOR");
  const actor=state.players.find(player=>player.seat===actorSeat);if(!actor||actor.lifeState==="eliminated"||actor.presence!=="inPlay")throw new Error("ACTION_ACTOR_INVALID");
  for(const group of definition.targetGroups){const offer=calculateTargetOffer(state,actorSeat,group.spec);validateTargetSelection(offer,selections.targetsByKey[group.key]??[]);}
  const tx=new EngineTransaction(state);tx.emit("action.declare",{actionId:definition.actionId,kind:definition.kind,actorSeat});tx.emit("action.legality.check",{actionId:definition.actionId});tx.emit("action.legal",{actionId:definition.actionId});tx.emit("action.targets.chosen",{actionId:definition.actionId,targetsByKey:selections.targetsByKey});
  tx.emit("action.costs.calculated",{actionId:definition.actionId,costIds:definition.costs.map(cost=>cost.costId)});payCostPlan(tx,actorSeat,{specs:definition.costs,selections:selections.costs});tx.emit("action.costs.paid",{actionId:definition.actionId});tx.emit("action.commit",{actionId:definition.actionId,kind:definition.kind,actorSeat});tx.emit("action.resolve.before",{actionId:definition.actionId});
  resolve(tx,{actionId:definition.actionId,kind:definition.kind,actorSeat,targetsByKey:structuredClone(selections.targetsByKey),context:structuredClone(input.context??{})});tx.emit("action.resolve",{actionId:definition.actionId});tx.emit("action.resolve.after",{actionId:definition.actionId});
  const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);validateAuthoritativeState(committed.state);return committed;
}
