import roomExamples from "../../../protocol/v1.3.4/examples/room-protocol.examples.json";
import type { LobbySnapshot, RoomCommand, RoomSnapshot } from "@skb-protocol/room-protocol";
import type { CardView, GameCommand, GameSnapshot, PresentationEvent, SetupSnapshot } from "@skb-protocol/client-protocol";
import { createProtocolGateway } from "../protocol/gateway";
import { useServerProjectionStore } from "../stores/serverProjection";
import { useCommandFeedbackStore } from "../stores/commandFeedback";

const lobby: LobbySnapshot = {
  type: "LOBBY_SNAPSHOT",
  serverTime: Date.now(),
  user: { userId: "u1", displayName: "Kurisu", latencyMs: 24 },
  rulesetVersions: ["1.3.4"],
  resumableGames: [{ gameId: "game_01", roomCode: "7KQ9MT", round: 4, statusText: "等待3号玩家响应" }]
};

const selectionSnapshot = structuredClone(roomExamples.cases[0]?.message) as unknown as RoomSnapshot;
if (selectionSnapshot.characterSelection) selectionSnapshot.characterSelection.lockedCharacterId = null;
const selectionViewer = selectionSnapshot.players.find((player) => player.userId === selectionSnapshot.viewerUserId);
if (selectionViewer) selectionViewer.selectionState = "choosing";
selectionSnapshot.players.push(
  { userId: "u3", displayName: "三号玩家", seat: 3, team: "B", isHost: false, ready: true, connection: "online", latencyMs: 38, selectionState: "locked", revealedCharacterId: null },
  { userId: "u4", displayName: "四号玩家", seat: 4, team: "A", isHost: false, ready: true, connection: "reconnecting", latencyMs: null, selectionState: "choosing", revealedCharacterId: null }
);

const roomSnapshot: RoomSnapshot = structuredClone(selectionSnapshot);
roomSnapshot.phase = "waiting";
roomSnapshot.roomRevision = 5;
roomSnapshot.characterSelection = null;
roomSnapshot.viewerUserId = "u2";
roomSnapshot.viewerSeat = 2;
roomSnapshot.permissions = { canChangeSeat: true, canUpdateSettings: true, canKick: true, canTransferHost: true, canStartGame: true, canCloseRoom: true, canDisbandRoom: true };
roomSnapshot.players = roomSnapshot.players.map((player) => ({ ...player, isHost: player.userId === roomSnapshot.viewerUserId, selectionState: "notStarted", revealedCharacterId: null }));

const card = (ref:string,templateId:string,displayName:string,category:CardView["category"],printedColor:CardView["printedColor"],resourceKey:string,summary:string):CardView => ({ ref,templateId,displayName,category,printedColor,resourceKey,summary,coreStats:[],badges:[],state:{effective:true,selected:false},detailAvailable:true });
const killCard=card("private:hand:kill","basic.kill.red","杀","basic","red","card.basic.kill.red","用于攻击或支付攻击费用");
const potionCard=card("private:hand:potion","basic.potion.green","药水","basic","green","card.basic.potion.green","恢复生命或护盾");
const weaponCard=card("public:seat2:weapon1","weapon.w01","火焰之鹰","weapon","red","card.weapon.w01","远程武器");
const armorCard=card("public:seat1:armor","armor.a01","圆盾","armor","none","card.armor.a01","防具");
const discardCard=card("public:discard:1","basic.dodge.blue","闪","basic","blue","card.basic.dodge.blue","抵消攻击");
const judgmentCard=card("public:seat3:judgment1","special.sp12","鲜血诅咒","special","red","card.special.sp12","准备阶段前结算");
const emptySlots=()=>({weapon1:null,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[],mountDual:false});
const gameSnapshot:GameSnapshot={
  type:"GAME_SNAPSHOT",gameId:"game_01",rulesetVersion:"1.3.4",stateRevision:20,lastEventSeq:40,serverTime:Date.now(),viewer:{userId:"u2",seat:2,team:"B"},
  publicView:{round:2,activeSeat:2,phase:"play",headline:"你的出牌阶段",drawPileCount:312,discardTop:[discardCard],centralCards:[],winnerTeam:null,players:[
    {seat:1,team:"A",nickname:"一号玩家",connected:true,characterId:"character.knight",lifeState:"inPlay",hp:6,maxHp:6,shield:4,maxShield:5,ironShield:0,handCount:4,handLimit:4,equipment:[armorCard],equipmentSlots:{...emptySlots(),armor:armorCard},judgmentZone:[],statuses:[]},
    {seat:2,team:"B",nickname:"Kurisu",connected:true,characterId:"character.alchemist",lifeState:"inPlay",hp:6,maxHp:6,shield:5,maxShield:5,ironShield:0,handCount:2,handLimit:4,equipment:[weaponCard],equipmentSlots:{...emptySlots(),weapon1:weaponCard},judgmentZone:[],statuses:[]},
    {seat:3,team:"B",nickname:"三号玩家",connected:true,characterId:"character.wizard",lifeState:"inPlay",hp:5,maxHp:5,shield:5,maxShield:5,ironShield:0,handCount:5,handLimit:4,equipment:[],equipmentSlots:emptySlots(),judgmentZone:[judgmentCard],statuses:["冰冻"]},
    {seat:4,team:"A",nickname:"四号玩家",connected:false,characterId:"character.ranger",lifeState:"inPlay",hp:6,maxHp:6,shield:3,maxShield:4,ironShield:1,handCount:3,handLimit:4,equipment:[],equipmentSlots:emptySlots(),judgmentZone:[],statuses:[]}
  ]},
  privateView:{hand:[killCard,potionCard],preselectedWeaponSlot:"weapon1",preselectedModeId:null,preselectableWeaponSlots:["weapon1","weapon2","thirdWeapon"],concealedChoices:[]},
  interaction:{prompt:{promptId:"prompt_play_20",kind:"playAction",mandatory:false,deadlineAt:Date.now()+60000,prioritySeat:2,timeoutPolicy:"pass"},offers:[
    {offerId:"offer_attack",kind:"declareAttack",sourceRefs:["private:hand:kill","public:seat2:weapon1"],legalTargetRefs:["public:seat_1","public:seat_4"],selectionSpecs:[{key:"source",kind:"cards",min:1,max:1,legalRefs:["private:hand:kill"]},{key:"targets",kind:"targets",min:1,max:1,legalRefs:["public:seat_1","public:seat_4"]}],targetRule:{min:1,max:1,distinct:true},preview:{weaponRef:"public:seat2:weapon1",range:3,costSummary:"1张杀 · 1次攻击"}},
    {offerId:"offer_potion",kind:"useCard",sourceRefs:["private:hand:potion"],legalTargetRefs:["public:seat_2"],selectionSpecs:[],preview:{costSummary:"药水×1"}},
    {offerId:"offer_color",kind:"resolveChoice",sourceRefs:[],legalTargetRefs:[],selectionSpecs:[{key:"color",kind:"color",min:1,max:1,options:["red","blue","green"]},{key:"confirm",kind:"confirm",min:1,max:1,options:[true,false]}],preview:{costSummary:"测试通用选择"}},
    {offerId:"offer_end",kind:"endPhase",sourceRefs:[],legalTargetRefs:[],selectionSpecs:[],preview:{}}
  ],disabledHints:[{subjectRef:"public:seat1:armor",reasonCode:"NOT_CURRENTLY_USABLE",messageKey:"game.hint.notCurrentWindow"}]},activeWindow:{kind:"playAction",prioritySeat:2,deadlineAt:Date.now()+60000,attackerSeat:null,abilityId:null},chat:[]
};

const setupSnapshot:SetupSnapshot={type:"SETUP_SNAPSHOT",gameId:"game_setup_01",rulesetVersion:"1.3.4",stateRevision:0,lastEventSeq:0,serverTime:Date.now(),lifecycle:"setupRedraw",viewer:{userId:"u2",seat:2,team:"B"},firstSeat:1,drawPileCount:321,discardPile:[],seats:[1,2,3,4].map(seat=>({seat:seat as 1|2|3|4,handCount:4,redrawDecided:false})),hand:[
  {ref:"private:u2:setup:1",templateId:"basic.kill.red",displayName:"杀",category:"basic",printedColor:"red",resourceKey:"card.basic.kill.red"},
  {ref:"private:u2:setup:2",templateId:"basic.dodge.blue",displayName:"闪",category:"basic",printedColor:"blue",resourceKey:"card.basic.dodge.blue"},
  {ref:"private:u2:setup:3",templateId:"basic.potion.green",displayName:"药水",category:"basic",printedColor:"green",resourceKey:"card.basic.potion.green"},
  {ref:"private:u2:setup:4",templateId:"weapon.w01",displayName:"火焰之鹰",category:"weapon",printedColor:"red",resourceKey:"card.weapon.w01"}
],redrawUsed:false,interaction:{prompt:{promptId:"prompt:setup-redraw:2",kind:"initialRedraw",mandatory:false,deadlineAt:Date.now()+10000,prioritySeat:2,timeoutPolicy:"pass"},offers:[{offerId:"offer:setup-redraw:2",kind:"resolveChoice",sourceRefs:[],legalTargetRefs:[],selectionSpecs:[{key:"confirm",kind:"confirm",min:1,max:1,options:[true,false]}],preview:{costSummary:"弃置全部4张并重摸4张"}}],disabledHints:[]}};

export type MockScene = "lobby" | "room" | "selection" | "setup" | "game";

export function createMockServer() {
  const store = useServerProjectionStore();
  const feedback = useCommandFeedbackStore();
  let current: RoomSnapshot = structuredClone(selectionSnapshot);
  const gateway = createProtocolGateway(
    { send: (command) => console.info("[mock transport]", command) },
    {
      onGameMessage: store.acceptGameMessage,
      onRoomMessage: store.acceptRoomMessage,
      onProtocolError: (_kind, errors) => store.reportProtocolError(errors)
    }
  );
  return {
    show(scene: MockScene) {
      store.resetProjection();
      current = structuredClone(scene === "room" ? roomSnapshot : selectionSnapshot);
      if(scene === "game") gateway.receive("game",structuredClone(gameSnapshot)); else if(scene === "setup") gateway.receive("game",structuredClone(setupSnapshot)); else gateway.receive("room", scene === "lobby" ? lobby : current);
    },
    send(command: RoomCommand) {
      setTimeout(() => {
        if (command.command === "CREATE_ROOM" || command.command === "JOIN_ROOM") current = structuredClone(roomSnapshot);
        if (command.command === "LEAVE_ROOM" || command.command === "CLOSE_ROOM") { store.resetProjection(); gateway.receive("room", lobby); feedback.accepted(command.commandId); return; }
        if (command.command === "SET_READY") { const me = current.players.find((p) => p.userId === current.viewerUserId); if (me) me.ready = (command.payload as {ready:boolean}).ready; }
        if (command.command === "CHANGE_SEAT") { const p=command.payload as {userId:string;seat:1|2|3|4}; const player=current.players.find(x=>x.userId===p.userId); if(player) { player.seat=p.seat; player.team=p.seat===1||p.seat===4?"A":"B"; if(player.userId===current.viewerUserId) current.viewerSeat=p.seat; } }
        if (command.command === "UPDATE_ROOM_SETTINGS") current.settings = structuredClone((command.payload as {settings:RoomSnapshot["settings"]}).settings);
        if (command.command === "KICK_PLAYER") { const userId=(command.payload as {userId:string}).userId; current.players=current.players.filter(x=>x.userId!==userId); }
        if (command.command === "TRANSFER_HOST") { const userId=(command.payload as {userId:string}).userId; current.players=current.players.map(x=>({...x,isHost:x.userId===userId})); current.permissions={canChangeSeat:true,canUpdateSettings:false,canKick:false,canTransferHost:false,canStartGame:false,canCloseRoom:false,canDisbandRoom:false}; }
        if (command.command === "START_GAME") { const next=structuredClone(selectionSnapshot); next.roomRevision=current.roomRevision; next.viewerUserId=current.viewerUserId; next.viewerSeat=current.viewerSeat; next.players=current.players.map(x=>({...x,selectionState:x.userId===current.viewerUserId?"choosing":"notStarted",revealedCharacterId:null})); current=next; }
        if (command.command === "PRESELECT_CHARACTER" && current.characterSelection) current.characterSelection.preselectedCharacterId = (command.payload as {characterId:string|null}).characterId;
        if (command.command === "LOCK_CHARACTER" && current.characterSelection) { current.characterSelection.lockedCharacterId = (command.payload as {characterId:string}).characterId; const me=current.players.find((p)=>p.userId===current.viewerUserId); if(me) me.selectionState="locked"; }
        if (command.command === "SEND_CHAT") { const p=command.payload as {channel:"all"|"team";text:string}; current.chat.push({messageId:`mock_${Date.now()}`,channel:p.channel,senderSeat:current.viewerSeat ?? 1,senderDisplayName:current.players.find(x=>x.userId===current.viewerUserId)?.displayName ?? "玩家",sentAt:Date.now(),text:p.text}); }
        current.roomRevision += 1; store.resetProjection(); gateway.receive("room", current); feedback.accepted(command.commandId);
      }, 180);
    },
    sendGame(command:GameCommand) {
      setTimeout(()=>{
        if(store.setupSnapshot){
          const next=JSON.parse(JSON.stringify(store.setupSnapshot)) as SetupSnapshot;
          next.stateRevision+=1;next.serverTime=Date.now();
          if(command.command==="EXECUTE_OFFER"&&command.offerId===next.interaction.offers[0]?.offerId){
            const redraw=(command.payload as {selections:Record<string,Array<string|number|boolean>>}).selections.confirm?.[0]===true;
            next.seats=next.seats.map(entry=>entry.seat===next.viewer.seat?{...entry,redrawDecided:true}:entry);
            next.redrawUsed=redraw;next.interaction={prompt:null,offers:[],disabledHints:[]};
            if(redraw){next.discardPile=next.hand.map((item,index)=>({...item,ref:`public:setup:discard:${index+1}`}));next.hand=next.hand.map((item,index)=>({...item,ref:`private:u2:replacement:${index+1}`}));next.drawPileCount-=4;}
          }
          store.resetProjection();gateway.receive("game",next);feedback.accepted(command.commandId);return;
        }
        const next=JSON.parse(JSON.stringify(store.gameSnapshot ?? gameSnapshot)) as GameSnapshot;
        next.stateRevision+=1; next.serverTime=Date.now();
        let presentation:PresentationEvent|undefined;
        if(command.command==="EXECUTE_OFFER") {
          const offerId=command.offerId;
          if(offerId==="offer_end") { next.publicView.phase="discard"; next.publicView.headline="弃牌阶段"; }
          if(offerId==="offer_attack") presentation={type:"PRESENTATION_EVENT",eventSeq:next.lastEventSeq+1,stateRevision:next.stateRevision,eventType:"ATTACK_TARGETED",payload:{sourceRef:"public:seat2:weapon1",targetRefs:["public:seat_1"]}};
          if(offerId==="offer_potion") presentation={type:"PRESENTATION_EVENT",eventSeq:next.lastEventSeq+1,stateRevision:next.stateRevision,eventType:"STATUS_CHANGED",payload:{targetRef:"public:seat_2",statusId:"mock.recovery",change:"applied"}};
          if(offerId==="offer_color") presentation={type:"PRESENTATION_EVENT",eventSeq:next.lastEventSeq+1,stateRevision:next.stateRevision,eventType:"JUDGMENT_RESULT_CHANGED",payload:{from:"white",to:"red",reason:"mock.choice"}};
          next.interaction.offers=offerId==="offer_end"?[]:next.interaction.offers.filter(x=>x.offerId!==offerId);
        }
        if(command.command==="SET_PRESELECTION") { const payload=command.payload as {weaponSlot:string|null;modeId:string|null}; if(next.privateView.preselectableWeaponSlots.includes(payload.weaponSlot??"")){next.privateView.preselectedWeaponSlot=payload.weaponSlot;next.privateView.preselectedModeId=payload.modeId;} }
        if(command.command==="SEND_CHAT") {const payload=command.payload as {channel:"all"|"team";text:string};next.chat.push({messageId:`game_chat_${Date.now()}`,channel:payload.channel,senderSeat:next.viewer.seat!,sentAt:Date.now(),text:payload.text});}
        if(presentation)next.lastEventSeq=presentation.eventSeq;
        store.resetProjection(); gateway.receive("game",next); if(presentation)gateway.receive("game",presentation); feedback.accepted(command.commandId);
      },180);
    }
  };
}
