import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState } from "./state.js";
import { processEventTriggers } from "./triggerBridge.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";

const payloadRecord=(value:JsonValue):Record<string,JsonValue>=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};

export function processStatusAppliedTriggerEvents(committed:TransactionCommit<AuthoritativeGameState>,ruleset:LoadedRuleset,deadlineAt:number):TransactionCommit<AuthoritativeGameState>{
  let state=committed.state;const events=[...committed.events];
  for(const original of committed.events){if(original.eventType!=="status.applied"&&original.eventType!=="status.refreshed")continue;const payload=payloadRecord(original.payload),normalized:DomainEvent={...original,eventType:"status.applied",payload:{...payload,result:original.eventType==="status.refreshed"?"refreshed":"applied"}};const processed=processEventTriggers(state,ruleset,normalized,deadlineAt,`event:${original.eventSeq}`);state=processed.state;events.push(...processed.events);}
  return {previousRevision:committed.previousRevision,state,events};
}
