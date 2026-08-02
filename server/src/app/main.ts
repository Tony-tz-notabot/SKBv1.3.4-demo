import {resolve} from "node:path";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {SkbApplicationServer} from "./server.js";

const root=resolve(import.meta.dirname,"../../../"),ruleset=await loadFrozenRuleset(resolve(root,"rulesets/v1.3.4")),rooms=new RoomService(ruleset,new JsonPersistence(process.env.SKB_DATA_FILE??resolve(root,"server/data/skb-state.json")));await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset),port=Number(process.env.PORT??8787);await server.listen(port);console.log(`SKB server listening on http://0.0.0.0:${port}`);
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>void server.close().then(()=>process.exit(0)));
