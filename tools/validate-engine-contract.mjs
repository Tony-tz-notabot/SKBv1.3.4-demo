import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const schemaPath=path.join(root,"protocol","v1.3.4","engine-contract.schema.json");
const schema=JSON.parse(fs.readFileSync(schemaPath,"utf8"));
const refs=[];
const walk=(value)=>{ if(Array.isArray(value)) return value.forEach(walk); if(!value||typeof value!=="object") return; if(value.$ref) refs.push(value.$ref); Object.values(value).forEach(walk); };
walk(schema);
for(const ref of refs){ const name=ref.split("/").at(-1); if(!ref.startsWith("#/$defs/")||!schema.$defs[name]) throw new Error(`unresolved engine contract ref: ${ref}`); }
const required=["AuthoritativeGameState","Lifecycle","SetupLifecycleState","RedrawDecisionState","ResolutionFrame","DurationState","ScheduledEffectState","CombatState","PreselectionState","EngineRequest","EngineResult","DomainEvent","RandomRecord","PendingWindow","AudienceProjection"];
for(const name of required) if(!schema.$defs[name]) throw new Error(`missing engine definition: ${name}`);
const operations=schema.$defs.EngineRequest.properties.operation.enum;
for(const operation of ["createGame","handleCommand","handleTimeout","projectViews","restoreSnapshot"]) if(!operations.includes(operation)) throw new Error(`missing operation: ${operation}`);
console.log(JSON.stringify({definitions:Object.keys(schema.$defs).length,refs:refs.length,operations:operations.length,result:"ok"},null,2));
