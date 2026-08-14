import {resolve} from "node:path";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import {JsonPersistence} from "./persistence.js";
import {MatchLogStore} from "./matchLogStore.js";
import {RoomService} from "./roomService.js";
import {SkbApplicationServer} from "./server.js";
import {startMemoryMonitor} from "./memoryMonitor.js";

const root=resolve(import.meta.dirname,"../../../"),ruleset=await loadFrozenRuleset(resolve(root,"rulesets/v1.3.4")),persistence=new JsonPersistence(process.env.SKB_DATA_FILE??resolve(root,"server/data/skb-state.json")),rooms=new RoomService(ruleset,persistence);await rooms.restore();const matchLogs=new MatchLogStore(process.env.SKB_LOG_DIR??resolve(root,"server/data/logs"));const server=new SkbApplicationServer(rooms,ruleset,rooms.restoredGameResultsSnapshot(),{serveStatic:true,matchLogs}),port=Number(process.env.PORT??8787);await server.listen(port);console.log(`SKB server listening on http://0.0.0.0:${port}`);startMemoryMonitor();
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>void server.close().then(()=>process.exit(0)));
