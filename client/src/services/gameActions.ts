import type { GameCommand } from "@skb-protocol/client-protocol";
import { buildGameCommand } from "../protocol/commandBuilders";
import { useCommandFeedbackStore } from "../stores/commandFeedback";
import { useServerProjectionStore } from "../stores/serverProjection";

let sender: ((command: GameCommand) => void) | null = null;
export const configureGameCommandSender = (value: (command: GameCommand) => void) => { sender = value; };
function context() { const store=useServerProjectionStore(); const snapshot=store.gameSnapshot ?? store.setupSnapshot; if(!snapshot) throw new Error("game or setup snapshot required"); return snapshot; }
function dispatch(command: GameCommand) { if(!sender) throw new Error("game command sender is not configured"); useCommandFeedbackStore().begin(command.commandId); sender(command); }
export const gameActions = {
  execute(offerId:string,selections:Record<string,Array<string|number|boolean>>) { const s=context(); const promptId=s.interaction.prompt?.promptId; if(!promptId) throw new Error("server offer requires promptId"); dispatch(buildGameCommand("EXECUTE_OFFER",{selections},{gameId:s.gameId,expectedStateRevision:s.stateRevision,promptId,offerId})); },
  setPreselection(weaponSlot:string|null,modeId:string|null) { const s=useServerProjectionStore().gameSnapshot; if(!s) throw new Error("game snapshot required"); dispatch(buildGameCommand("SET_PRESELECTION",{weaponSlot,modeId},{gameId:s.gameId,expectedStateRevision:s.stateRevision})); },
  sendChat(channel:"all"|"team",text:string) { const s=useServerProjectionStore().gameSnapshot; if(!s) throw new Error("game snapshot required"); dispatch(buildGameCommand("SEND_CHAT",{channel,clientMessageId:crypto.randomUUID(),text},{gameId:s.gameId,expectedStateRevision:s.stateRevision})); },
  forfeit() { const s=useServerProjectionStore().gameSnapshot; if(!s) throw new Error("game snapshot required"); dispatch(buildGameCommand("FORFEIT",{},{gameId:s.gameId,expectedStateRevision:s.stateRevision})); },
};
