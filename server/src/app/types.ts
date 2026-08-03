import type {AuthoritativeGameState,Seat,Team} from "../engine/state.js";

export interface AppUser {userId:string;displayName:string}
export interface AppSettings {roomName:string;allowGuests:boolean;allowSpectators:boolean;turnTimeSeconds:number;responseTimeSeconds:number;reserveTimeSeconds:number;rulesetVersion:"1.3.4";dismantleBossEnabled:boolean}
export interface AppPlayer extends AppUser {seat:Seat;team:Team;isHost:boolean;ready:boolean;connection:"online"|"reconnecting"|"offline";latencyMs:number|null;selectionState:"notStarted"|"choosing"|"locked"|"revealed";candidates:string[];preselectedCharacterId:string|null;lockedCharacterId:string|null;selectionDeadlineAt:number|null;disconnectDeadlineAt?:number|null}
export interface AppChat {messageId:string;clientMessageId:string;channel:"all"|"team";senderSeat:Seat;senderDisplayName:string;sentAt:number;text:string}
export interface AppRoom {roomId:string;roomCode:string;revision:number;phase:"waiting"|"characterSelection"|"starting"|"inGame"|"closed";settings:AppSettings;passwordHash:string|null;players:AppPlayer[];spectators:AppUser[];chat:AppChat[];gameChat:AppChat[];game:AuthoritativeGameState|null;createdAt:number;updatedAt:number}
export interface AppSession {userId:string;displayName:string;createdAt:number;salt?:string}
export interface AppAccount {username:string;userId:string;displayName:string;passwordSalt:string;passwordHash:string;createdAt:number}
export interface PersistedApplication {version:1;rooms:AppRoom[];sessions:Record<string,AppSession>;accounts:Record<string,AppAccount>;roomCommandResults:Record<string,Record<string,JsonObject>>;gameCommandResults:Record<string,Record<string,JsonObject>>}
export type JsonObject=Record<string,unknown>;
