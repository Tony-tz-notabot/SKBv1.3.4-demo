import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState} from "../engine/state.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const settings={roomName:"事件",allowGuests:true,allowSpectators:true,turnTimeSeconds:30,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
async function startedRoom(){const dir=await mkdtemp(join(tmpdir(),"skb-presentation-")),rooms=new RoomService(ruleset,new JsonPersistence(join(dir,"state.json")));dirs.push(dir);const users=[1,2,3,4].map(n=>({userId:`s${n}`,displayName:`玩家${n}`})),created=await rooms.handle(users[0]!,{commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}}),room=created.room!;for(let i=1;i<4;i++)await rooms.handle(users[i]!,{commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode:room.roomCode,password:null,asSpectator:false}});for(const user of users)await rooms.handle(user,{commandId:`ready${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"SET_READY",payload:{ready:true}});await rooms.handle(users[0]!,{commandId:"start",roomId:room.roomId,expectedRoomRevision:room.revision,command:"START_GAME",payload:{}});for(const user of users){const player=room.players.find(x=>x.userId===user.userId)!;await rooms.handle(user,{commandId:`lock${user.userId}`,roomId:room.roomId,expectedRoomRevision:room.revision,command:"LOCK_CHARACTER",payload:{characterId:player.candidates[0]}})}return{rooms,room,users};}

describe("presentation event mapping",()=>{
 it("maps every mapped domain event type to a schema-valid PRESENTATION_EVENT",async()=>{const {room,users}=await startedRoom();for(const seat of[1,2,3,4]as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;const state=room.game!,projector=new GameProjector(ruleset),handCard=state.zones["hand:1"]!.orderedCardRefs[0]!,cardOf=(ref:string)=>({seat:1,cardRef:ref,purpose:"play"});
  const cases:Array<[string,Record<string,unknown>,string]>=[
   ["card.drawn",{seat:1,cardRefs:[handCard],requestedCount:1,actualCount:1,reason:"effect.draw"},"CARD_DRAWN"],
   ["cards.given",{fromSeat:2,toSeat:3,cardRefs:[],reason:"talent.extra_gem.death"},"CARD_DRAWN"],
   ["card.played",{seat:1,cardRef:handCard,purpose:"attack.killCost"},"CARD_PLAYED"],
   ["card.equipped",{seat:1,cardRef:handCard,zoneRef:"weapon:1:1"},"CARD_PLAYED"],
   ["card.synthesized",{seat:1,cardRef:handCard},"CARD_PLAYED"],
   ["card.transformed",{seat:1,cardRef:handCard},"CARD_PLAYED"],
   ["card.discarded",{seat:1,cardRef:handCard,reason:"handLimit"},"CARD_DISCARDED"],
   ["card.dismantled",{cardRef:handCard,sourceSeat:1,targetSeat:1},"CARD_DISCARDED"],
   ["card.lost",{cardRef:handCard,ownerSeat:1,seat:1,fromZoneRef:"hand:1"},"CARD_DISCARDED"],
   ["attack.declare",{attackId:"attack:1:1",attackerSeat:1},"ATTACK_DECLARED"],
   ["attack.resolved",{attackId:"attack:1:1"},"ATTACK_RESOLVED"],
   ["attack.miss",{attackId:"attack:1:1",targetRef:"character:2",reason:"meleeBlock"},"ATTACK_RESOLVED"],
   ["attack.invalidated",{attackId:"attack:1:1",sourceKind:"armor.a05",result:"miss"},"ATTACK_RESOLVED"],
   ["attack.cancelled",{attackId:"attack:1:1",reason:"paidTargetBecameIllegal"},"ATTACK_RESOLVED"],
   ["attack.after",{attackId:"attack:1:1",targetRef:"character:2"},"ATTACK_RESOLVED"],
   ["damage.prevented",{attackId:"attack:1:1",targetRef:"character:2",segmentId:"s1",reason:"elementImmunity",element:"fire"},"DAMAGE_PREVENTED"],
   ["health.hpLost",{seat:2,amount:2,attackId:"attack:1:1"},"HEALTH_CHANGED"],
   ["hp.recovered",{seat:1,amount:1,sourceRef:handCard},"HEALTH_CHANGED"],
   ["health.recovered",{seat:1,amount:1,hp:5},"HEALTH_CHANGED"],
   ["shield.shieldLost",{seat:2,amount:1},"HEALTH_CHANGED"],
   ["shield.recovered",{seat:2,amount:1,shield:2},"HEALTH_CHANGED"],
   ["shield.broken",{seat:2,attackId:"attack:1:1",segmentId:"s1"},"HEALTH_CHANGED"],
   ["status.prevented",{targetRef:"character:2",statusId:"status.frozen"},"STATUS_PREVENTED"],
   ["trigger.passed",{seat:1,abilityId:"skill.wizard.spell_strike"},"TRIGGER_RESOLVED"],
   ["trigger.resolved",{seat:1},"TRIGGER_RESOLVED"],
   ["ability.passed",{seat:1,abilityId:"skill.x"},"TRIGGER_RESOLVED"],
   ["ability.resolved",{seat:1,abilityId:"skill.x"},"TRIGGER_RESOLVED"],
   ["deck.reshuffled",{randomSeq:1,count:5,reason:"draw"},"DECK_RESHUFFLED"],
   ["deck.exhausted",{reason:"draw"},"DECK_RESHUFFLED"],
   ["turn.start",{seat:2,round:1},"TURN_CHANGED"],
   ["turn.end",{seat:2,round:1},"TURN_CHANGED"],
   ["choice.requested",{seat:1,kind:"playPhaseAction"},"CHOICE_REQUESTED"],
   ["counter.changed",{seat:1,counterId:"trap.bombs",from:0,to:2},"COUNTER_CHANGED"],
   ["marker.changed",{seat:1,markerId:"aim",from:0,to:1},"COUNTER_CHANGED"],
   ["cooldown.started",{seat:1,abilityId:"skill.general.mortar",cooldown:2},"COUNTER_CHANGED"],
   ["weapon.durability.changed",{weaponRef:handCard,before:2,after:1},"DURABILITY_CHANGED"],
   ["armor.durability.changed",{seat:1,armorRef:handCard,from:1,to:0},"DURABILITY_CHANGED"],
   ["judgment.finalized",{judgmentId:"j1",printedColor:"red",finalColor:"blue",overridden:true},"JUDGMENT_RESULT_CHANGED"],
   ["judgment.card.revealed",{judgmentId:"j1",cardRef:handCard,printedColor:"red"},"JUDGMENT_REVEALED"],
   ["phase.start",{seat:1,phase:"prepare"},"PHASE_CHANGED"],
   ["card.moved",{cardRef:handCard,fromZoneRef:"hand:1",toZoneRef:"discardPile"},"CARD_MOVED"],
   ["card.revealed",{cardRef:handCard},"CARD_REVEALED"],
   ["attack.targets.chosen",{attackId:"attack:1:1",targetRefs:["character:2"]},"ATTACK_TARGETED"],
   ["response.window.opened",{attackId:"attack:1:1",targetRef:"character:2",promptId:"prompt:r",prioritySeat:2,kind:"attackResponse"},"RESPONSE_WINDOW_OPENED"],
   ["response.passed",{attackId:"attack:1:1",targetRef:"character:2",seat:2},"RESPONSE_RESOLVED"],
   ["damage.applied",{attackId:"attack:1:1",targetRef:"character:2",segmentIndex:1,totalSegments:1,amount:2,actualHpLoss:2,actualShieldLoss:0},"DAMAGE_SEGMENT_APPLIED"],
   ["status.applied",{targetRef:"character:2",statusId:"status.frozen",result:"applied"},"STATUS_CHANGED"],
   ["dying.enter",{dyingRef:"character:2"},"DYING_STARTED"],
   ["dying.rescued",{targetRef:"character:2"},"CHARACTER_RESCUED"],
   ["death.occurred",{targetRef:"character:2"},"CHARACTER_DIED"],
   ["elimination.occurred",{dyingRef:"character:2"},"CHARACTER_ELIMINATED"],
   ["game.victory",{winnerTeam:"A"},"GAME_ENDED"],
   ["game.start",{firstSeat:1},"GAME_STARTED"],
  ];
  const covered=new Set<string>();
  for(const [domainType,payload,expected] of cases){
   const event={eventType:domainType,payload:payload as any,eventSeq:1,stateRevision:state.stateRevision},presented=projector.presentationFor(state,users[0]!.userId,[event])[0];
   expect(presented,domainType).toBeTruthy();expect(presented!.eventType,domainType).toBe(expected);covered.add(expected);
   expect(validateProtocol("game",presented),`${domainType}->${expected}`).toEqual({ok:true});
  }
  expect([...covered].sort()).toEqual(["ATTACK_DECLARED","ATTACK_RESOLVED","ATTACK_TARGETED","CARD_DISCARDED","CARD_DRAWN","CARD_MOVED","CARD_PLAYED","CARD_REVEALED","CHARACTER_DIED","CHARACTER_ELIMINATED","CHARACTER_RESCUED","CHOICE_REQUESTED","COUNTER_CHANGED","DAMAGE_PREVENTED","DAMAGE_SEGMENT_APPLIED","DECK_RESHUFFLED","DURABILITY_CHANGED","DYING_STARTED","GAME_ENDED","GAME_STARTED","HEALTH_CHANGED","JUDGMENT_RESULT_CHANGED","JUDGMENT_REVEALED","PHASE_CHANGED","RESPONSE_RESOLVED","RESPONSE_WINDOW_OPENED","STATUS_CHANGED","STATUS_PREVENTED","TRIGGER_RESOLVED","TURN_CHANGED"].sort());
  expect(covered.has("ACTION_COMMITTED")).toBe(false);
 });
 it("maps setup redraw events to SETUP_REDRAW_RESOLVED while in the redraw lifecycle",async()=>{const {room,users}=await startedRoom(),state=room.game!,projector=new GameProjector(ruleset);
  for(const [domainType,payload] of [["choice.passed",{seat:1}],["card.discarded",{seat:1,cardRefs:[]}]] as Array<[string,Record<string,unknown>]>){
   const presented=projector.presentationFor(state,users[0]!.userId,[{eventType:domainType,payload:payload as any,eventSeq:1,stateRevision:state.stateRevision}])[0];
   expect(presented?.eventType).toBe("SETUP_REDRAW_RESOLVED");expect(validateProtocol("game",presented)).toEqual({ok:true});
  }
 });
 it("keeps drawn card refs private to the owner",async()=>{const {room,users}=await startedRoom();for(const seat of[1,2,3,4]as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;const state=room.game! as AuthoritativeGameState,projector=new GameProjector(ruleset),handCard=state.zones["hand:1"]!.orderedCardRefs[0]!,event={eventType:"card.drawn" as const,payload:{seat:1,cardRefs:[handCard],requestedCount:1,actualCount:1,reason:"test"},eventSeq:1,stateRevision:state.stateRevision};
  const owner=projector.presentationFor(state,users[0]!.userId,[event])[0]!,other=projector.presentationFor(state,users[1]!.userId,[event])[0]!;
  expect(owner.payload).toMatchObject({seat:1,count:1});expect((owner.payload as any).cardRefs).toHaveLength(1);
  expect((other.payload as any).cardRefs??[]).toHaveLength(0);expect(JSON.stringify(other)).not.toContain("private:");
  expect(validateProtocol("game",owner)).toEqual({ok:true});expect(validateProtocol("game",other)).toEqual({ok:true});
 });
 it("maps every schema presentation eventType through a representative domain event",async()=>{const {room,users}=await startedRoom();for(const seat of[1,2,3,4]as const)room.game=resolveInitialRedraw(room.game!,seat,false,ruleset).state;const state=room.game!,projector=new GameProjector(ruleset),schema=JSON.parse(await (await import("node:fs/promises")).readFile(resolve(import.meta.dirname,"../../../protocol/v1.3.4/client-protocol.schema.json"),"utf8")) as {["$defs"]:{PresentationEvent:{properties:{eventType:{enum:string[]}}}}},enumeration=schema.$defs.PresentationEvent.properties.eventType.enum;
  for(const eventType of enumeration){
   const payload=eventType==="ACTION_COMMITTED"?{sourceRef:"public:seat_1",actionKind:"any"}:eventType==="SETUP_REDRAW_RESOLVED"?{seat:1,redraw:false}:{};
   const stateToUse=eventType==="SETUP_REDRAW_RESOLVED"?state:{...state};
   const event={eventType:eventType==="SETUP_REDRAW_RESOLVED"?"choice.passed":"phase.start",payload,eventSeq:1,stateRevision:stateToUse.stateRevision};
   const presented=projector.presentationFor(stateToUse,users[0]!.userId,[event])[0];
   expect(presented,eventType).toBeTruthy();expect(validateProtocol("game",presented),eventType).toEqual({ok:true});
  }
 });
});
