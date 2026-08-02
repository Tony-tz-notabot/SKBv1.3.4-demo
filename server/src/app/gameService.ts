import type {LoadedRuleset} from "../ruleset/types.js";
import {SetupCommandSession} from "../engine/setupCommands.js";
import {PhaseCommandSession} from "../engine/phaseCommands.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {setWeaponPreselection} from "../engine/preselection.js";
import {AttackResponseSession} from "../engine/response.js";
import {DyingCommandSession} from "../engine/dying.js";
import {JudgmentDesignationSession} from "../engine/judgmentDesignation.js";
import {JudgmentInterventionSession} from "../engine/judgmentIntervention.js";
import {PreJudgmentSession} from "../engine/preJudgment.js";
import {OptionalTriggerSession,TriggerOrderingSession} from "../engine/triggerWindows.js";
import type {AppRoom,AppUser,JsonObject} from "./types.js";
import {internalRef} from "./projection.js";
import {executePlayOffer} from "./playRegistry.js";
import {executeWindow,timeoutWindow} from "./windowRegistry.js";

type Command=Record<string,unknown>&{commandId:string;gameId:string;expectedStateRevision:number;command:string;payload?:Record<string,unknown>;promptId?:string|null;offerId?:string|null};
export type GameResult={accepted:true;commandId:string;stateRevision:number;firstEventSeq:number}|{accepted:false;commandId:string;reasonCode:string;messageKey:string;stateRevision:number;refreshRequired:boolean};

export class GameService{
 private results=new Map<string,GameResult>();
 constructor(private ruleset:LoadedRuleset,private clock:()=>number=Date.now){}
 handle(room:AppRoom,user:AppUser,command:Command):GameResult{
  const previous=this.results.get(command.commandId);if(previous)return structuredClone(previous);
  const reject=(reasonCode:string,refreshRequired=false):GameResult=>{const result={accepted:false as const,commandId:command.commandId,reasonCode,messageKey:`command.${reasonCode.toLowerCase()}`,stateRevision:room.game?.stateRevision??0,refreshRequired};this.results.set(command.commandId,result);return result};
  if(!room.game||room.game.gameId!==command.gameId)return reject("GAME_NOT_FOUND");
  if(!room.players.some(x=>x.userId===user.userId))return reject("PLAYER_NOT_IN_GAME");
  if(command.expectedStateRevision!==room.game.stateRevision)return reject("STALE_REVISION",true);
  try{
   if(command.command==="SEND_CHAT")return reject("CHAT_ROUTED_BY_APPLICATION");
   if(command.command==="SET_PRESELECTION"){
    const actor=room.game.players.find(x=>x.userId===user.userId)!,payload=command.payload??{},committed=setWeaponPreselection(room.game,actor.seat,typeof payload.weaponSlot==="string"?internalRef(payload.weaponSlot):null,typeof payload.modeId==="string"?payload.modeId:null,this.ruleset);room.game=committed.state;return this.accept(command,room,committed.events[0]?.eventSeq??room.game.lastEventSeq);
   }
   if(command.command!=="EXECUTE_OFFER"||!command.promptId||!command.offerId)return reject("COMMAND_UNSUPPORTED");
   const selections=command.payload?.selections as Record<string,unknown[]>|undefined;
   if(room.game.lifecycle==="setupRedraw"){
    const redraw=selections?.confirm?.[0]===true,session=new SetupCommandSession(room.game,this.ruleset,this.clock),out=session.handle({commandId:command.commandId,gameId:command.gameId,expectedStateRevision:command.expectedStateRevision,actorUserId:user.userId,promptId:command.promptId,offerId:command.offerId,redraw});
    if(!out.accepted){const result={accepted:false as const,commandId:out.commandId,reasonCode:out.reasonCode,messageKey:out.messageKey,stateRevision:out.stateRevision,refreshRequired:out.refreshRequired};this.results.set(command.commandId,result);return result}room.game=session.state;this.stabilize(room);return this.accept(command,room,out.firstEventSeq??room.game.lastEventSeq);
   }
   const window=room.game.pendingWindows.find(x=>x.promptId===command.promptId);
   if(window?.kind==="playPhaseAction"&&!command.offerId.includes("finish")){
    const normalized=Object.fromEntries(Object.entries(selections??{}).map(([key,values])=>[key,values.map(value=>typeof value==="string"?internalRef(value):value)])),executed=executePlayOffer(room.game,this.ruleset,user.userId,()=>this.clock()+room.settings.responseTimeSeconds*1000,{commandId:command.commandId,gameId:command.gameId,expectedStateRevision:command.expectedStateRevision,promptId:command.promptId,offerId:command.offerId,selections:normalized});if(executed){if(!executed.result.accepted)return reject(executed.result.reasonCode,executed.result.refreshRequired);room.game=executed.session.state;this.stabilize(room);return this.accept(command,room,executed.result.events?.[0]?.eventSeq??room.game!.lastEventSeq);}
   }
   if(window){const normalized=Object.fromEntries(Object.entries(selections??{}).map(([key,values])=>[key,values.map(value=>typeof value==="string"?internalRef(value):value)])),executed=executeWindow(room.game,this.ruleset,user.userId,()=>this.clock()+room.settings.responseTimeSeconds*1000,{commandId:command.commandId,gameId:command.gameId,expectedStateRevision:command.expectedStateRevision,promptId:command.promptId,offerId:command.offerId,selections:normalized});if(executed){if(!executed.result.accepted)return reject(executed.result.reasonCode,executed.result.refreshRequired);room.game=executed.session.state;this.stabilize(room);return this.accept(command,room,executed.result.events?.[0]?.eventSeq??room.game!.lastEventSeq);}}
   if(window){
    const cards=(selections?.cards??[]).filter((x):x is string=>typeof x==="string").map(internalRef),base={commandId:command.commandId,gameId:command.gameId,expectedStateRevision:command.expectedStateRevision,actorUserId:user.userId,promptId:command.promptId,offerId:command.offerId},session=
     window.kind==="attackResponse"?new AttackResponseSession(room.game,this.ruleset):
     window.kind==="dyingRescue"?new DyingCommandSession(room.game,()=>this.clock()+room.settings.responseTimeSeconds*1000,this.ruleset):
     window.kind==="judgmentDesignation"?new JudgmentDesignationSession(room.game):
     window.kind==="judgmentIntervention"?new JudgmentInterventionSession(room.game,this.ruleset):
     window.kind==="preJudgment"?new PreJudgmentSession(room.game,this.ruleset):
     window.kind==="optionalTrigger"?new OptionalTriggerSession(room.game,this.ruleset):
     window.kind==="triggerOrdering"?new TriggerOrderingSession(room.game,this.ruleset):null;
    if(session){const out=(session as any).handle({...base,...(window.kind==="attackResponse"||window.kind==="dyingRescue"?{cardRef:cards[0]}:{}),...(window.kind==="preJudgment"?{cardRefs:cards}:{})});if(!out.accepted)return reject(out.reasonCode,out.refreshRequired);room.game=(session as any).state;this.stabilize(room);return this.accept(command,room,out.events?.[0]?.eventSeq??room.game!.lastEventSeq);}
   }
   if(window&&(window.kind==="playPhaseAction"||window.kind==="discardPhaseAction")&&(command.offerId.includes("finish")||window.kind==="discardPhaseAction")){
    const cards=(selections?.cards??[]).filter((x):x is string=>typeof x==="string").map(internalRef),session=new PhaseCommandSession(room.game),out=session.handle({commandId:command.commandId,gameId:command.gameId,expectedStateRevision:command.expectedStateRevision,actorUserId:user.userId,promptId:command.promptId,offerId:command.offerId,cardRefs:cards});
    if(!out.accepted)return reject(out.reasonCode,out.refreshRequired);room.game=session.state;this.stabilize(room);return this.accept(command,room,out.firstEventSeq??room.game.lastEventSeq);
   }
   return reject("OFFER_HANDLER_NOT_REGISTERED",true);
  }catch(error){return reject(error instanceof Error?error.message:"COMMAND_FAILED",true)}
 }
 timeout(room:AppRoom):boolean{const state=room.game;if(!state)return false;
  if(state.lifecycle==="setupRedraw"&&state.setup&&state.setup.redrawDeadlineAt<=this.clock()){let changed=false;for(const player of state.players){if(room.game!.setup!.redrawBySeat[player.seat].decided)continue;const session=new SetupCommandSession(room.game!,this.ruleset,this.clock),out=session.handleTimeout(player.seat,`timeout:setup:${room.game!.stateRevision}:${player.seat}`);if(out.accepted){room.game=session.state;changed=true}}if(changed)this.stabilize(room);return changed;}
  const w=state.pendingWindows.find(x=>x.deadlineAt<=this.clock());if(!w)return false;const registered=timeoutWindow(state,this.ruleset,()=>this.clock()+room.settings.responseTimeSeconds*1000,`timeout:${w.promptId}:${state.stateRevision}`);if(registered?.result.accepted){room.game=registered.session.state;this.stabilize(room);return true}const session=w.kind==="attackResponse"?new AttackResponseSession(state,this.ruleset):w.kind==="dyingRescue"?new DyingCommandSession(state,()=>this.clock()+room.settings.responseTimeSeconds*1000,this.ruleset):w.kind==="judgmentDesignation"?new JudgmentDesignationSession(state):w.kind==="judgmentIntervention"?new JudgmentInterventionSession(state,this.ruleset):w.kind==="preJudgment"?new PreJudgmentSession(state,this.ruleset):w.kind==="optionalTrigger"?new OptionalTriggerSession(state,this.ruleset):w.kind==="triggerOrdering"?new TriggerOrderingSession(state,this.ruleset):w.kind==="playPhaseAction"||w.kind==="discardPhaseAction"?new PhaseCommandSession(state):null;if(!session||typeof(session as any).handleTimeout!=="function")return false;const out=(session as any).handleTimeout(`timeout:${w.promptId}:${state.stateRevision}`);if(!out.accepted)return false;room.game=(session as any).state;this.stabilize(room);return true;
 }
 private stabilize(room:AppRoom){if(!room.game)return;const result=runAutomaticScheduler(room.game,this.ruleset,()=>this.clock()+room.settings.responseTimeSeconds*1000);room.game=result.state;}
 private accept(command:Command,room:AppRoom,firstEventSeq:number){const result={accepted:true as const,commandId:command.commandId,stateRevision:room.game!.stateRevision,firstEventSeq:Math.max(1,firstEventSeq)};this.results.set(command.commandId,result);return result;}
}
