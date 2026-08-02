import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import Ajv2020Module,{type ErrorObject,type ValidateFunction} from "ajv/dist/2020.js";

export type ProtocolChannel="room"|"game";
export type ValidationResult={ok:true}|{ok:false;errors:string[]};
const protocolRoot=resolve(import.meta.dirname,"../../../protocol/v1.3.4");
const load=(name:string)=>JSON.parse(readFileSync(resolve(protocolRoot,name),"utf8"));
const Ajv2020=Ajv2020Module as unknown as new(options:object)=>{compile(schema:object):ValidateFunction};
const ajv=new Ajv2020({allErrors:true,strict:false}),schemas={room:load("room-protocol.schema.json"),game:load("client-protocol.schema.json")};
const validators:Record<ProtocolChannel,ValidateFunction>={room:ajv.compile(schemas.room),game:ajv.compile(schemas.game)};
const errors=(items:ErrorObject[]|null|undefined)=>(items??[]).map(x=>`${x.instancePath||"$"} ${x.message??"protocol error"}`);
const mappedPayloadErrors=(channel:ProtocolChannel,value:unknown):string[]=>{if(!value||typeof value!=="object"||!("type" in value))return[];const object=value as {type?:unknown;command?:unknown;payload?:unknown},kind=object.type==="ROOM_COMMAND"?"RoomCommand":object.type==="GAME_COMMAND"?"GameCommand":null;if(!kind)return[];const schema=schemas[channel],definition=schema.$defs[kind] as {["x-commandPayloadMap"]?:Record<string,string>}|undefined,map=definition?.["x-commandPayloadMap"],ref=map?.[String(object.command)];if(!ref)return[`missing ${kind} payload map for ${String(object.command)}`];const validate=ajv.compile({$ref:`${schema.$id}#/$defs/${ref}`});return validate(object.payload)?[]:errors(validate.errors);};
export function validateProtocol(channel:ProtocolChannel,value:unknown):ValidationResult{const validate=validators[channel];if(!validate(value))return{ok:false,errors:errors(validate.errors)};const mapped=mappedPayloadErrors(channel,value);return mapped.length?{ok:false,errors:mapped}:{ok:true};}
export function assertProtocol(channel:ProtocolChannel,value:unknown){const result=validateProtocol(channel,value);if(!result.ok)throw new Error(`PROTOCOL_${channel.toUpperCase()}_INVALID: ${result.errors.join("; ")}`);}
