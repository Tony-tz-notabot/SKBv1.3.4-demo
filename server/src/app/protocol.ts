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
export function validateProtocol(channel:ProtocolChannel,value:unknown):ValidationResult{const validate=validators[channel];return validate(value)?{ok:true}:{ok:false,errors:errors(validate.errors)};}
export function assertProtocol(channel:ProtocolChannel,value:unknown){const result=validateProtocol(channel,value);if(!result.ok)throw new Error(`PROTOCOL_${channel.toUpperCase()}_INVALID: ${result.errors.join("; ")}`);}
