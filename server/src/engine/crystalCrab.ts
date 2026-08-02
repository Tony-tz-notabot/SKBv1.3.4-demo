import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateTargetOffer } from "./targets.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

const activeCrab = (state: AuthoritativeGameState, seat: Seat) => { const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0], card = ref ? state.cards[ref] : undefined; return card?.templateId === "boss.crystal_crab" && card.runtime.active === true ? card : undefined; };
const targets = (state: AuthoritativeGameState, seat: Seat) => calculateTargetOffer(state, seat, { kind: "character", min: 0, max: 1, distinct: true, includeSelf: true, team: "any", presence: "inPlay" }).legalTargetRefs;
const customJudgments = [{ judgmentId: "crystalCrabPincer", timing: "hitDetermined.beforeDamage", purpose: "criticalAndStatus", runOnHit: true, outcomes: { white: { matched: true, effects: [{ op: "applyStatus", params: { statusId: "status.frozen" } }] }, blue: { matched: true, effects: [{ op: "applyStatus", params: { statusId: "status.frozen" } }] }, default: { matched: false, effects: [] } } }];

export function openCrystalCrabActivePincerWindow(tx: EngineTransaction<AuthoritativeGameState>, ruleset: LoadedRuleset, seat: Seat, deadlineAt: number): void {
  const card = activeCrab(tx.draft, seat), ordinal = Number(card?.runtime.ownerTurnOrdinal ?? 0), marker = `activePincerWindowResolved.${ordinal}`;
  if (!card || ![1, 2].includes(ordinal) || card.runtime[marker] === true || Number(tx.draft.players.find((item) => item.seat === seat)!.markers["crystalCrab.passivePincerLaunchedInWindow"] ?? 0) > 0) return;
  card.runtime[marker] = true; const legalTargetRefs = targets(tx.draft, seat), promptId = `prompt:crab-active-pincer:${card.cardRef}:${ordinal}`;
  tx.draft.pendingWindows.push({ promptId, kind: "crystalCrabActivePincer", prioritySeat: seat, mandatory: false, deadlineAt, timeoutPolicy: "pass", legalOfferIds: [`offer:crab-active-pincer:pass:${card.cardRef}:${ordinal}`, ...(legalTargetRefs.length ? [`offer:crab-active-pincer:attack:${card.cardRef}:${ordinal}`] : [])], context: { cardRef: card.cardRef, ordinal, legalTargetRefs } });
  tx.emit("choice.requested", { kind: "crystalCrabActivePincer", promptId, seat, cardRef: card.cardRef, ordinal, legalTargetRefs });
}
export interface CrabPincerCommand { commandId: string; gameId: string; expectedStateRevision: number; actorUserId: string; promptId: string; offerId: string; targetRef?: string; }
export type CrabPincerResult = { accepted: true; commandId: string; previousRevision: number; stateRevision: number; events: DomainEvent[] } | { accepted: false; commandId: string; stateRevision: number; reasonCode: string; refreshRequired: boolean };
export class CrystalCrabActivePincerSession {
  #state: AuthoritativeGameState; readonly #results = new Map<string, CrabPincerResult>(); constructor(state: AuthoritativeGameState, private readonly ruleset: LoadedRuleset) { this.#state = state; } get state() { return this.#state; }
  handle(command: CrabPincerCommand): CrabPincerResult {
    const prior = this.#results.get(command.commandId); if (prior) return structuredClone(prior); const reject = (reasonCode: string, refreshRequired: boolean): CrabPincerResult => { const result = { accepted: false as const, commandId: command.commandId, stateRevision: this.#state.stateRevision, reasonCode, refreshRequired }; this.#results.set(command.commandId, result); return structuredClone(result); };
    if (command.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false); if (command.expectedStateRevision !== this.#state.stateRevision) return reject("STALE_REVISION", true);
    const window = this.#state.pendingWindows.find((item) => item.kind === "crystalCrabActivePincer"); if (!window || window.promptId !== command.promptId) return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find((item) => item.userId === command.actorUserId); if (!actor || actor.seat !== window.prioritySeat) return reject("NOT_YOUR_PRIORITY", false); if (!window.legalOfferIds.includes(command.offerId)) return reject("OFFER_EXPIRED", true);
    const attack = command.offerId.includes(":attack:"); if (attack && (!command.targetRef || !targets(this.#state, actor.seat).includes(command.targetRef))) return reject("TARGET_NO_LONGER_LEGAL", true); if (!attack && command.targetRef) return reject("TARGET_INVALID", false);
    const tx = new EngineTransaction(this.#state); tx.draft.pendingWindows = tx.draft.pendingWindows.filter((item) => item.promptId !== window.promptId);
    if (attack) { const cardRef = String(window.context?.cardRef), card = activeCrab(tx.draft, actor.seat); if (!card || card.cardRef !== cardRef) return reject("BOSS_NO_LONGER_ACTIVE", true); createScriptedAttackInTransaction(tx, { attackId: `attack:crab-active:${cardRef}:${String(window.context?.ordinal)}`, attackerSeat: actor.seat, targetRef: command.targetRef!, sourceRef: cardRef, weaponId: "boss.crystal_crab.pincer", modeId: "activePincer", range: "unlimited", attackTypes: ["melee"], damageSegments: [{ segmentId: "pincer", deliveryType: "attack", attackType: "melee", damageType: "normal", element: "none", amount: 1, repeat: 1, isAdditional: false, overflowPolicy: "normal" }], customJudgments, tags: ["bossAttack", "crystalCrabActivePincer"] }); }
    else tx.emit("boss.specialWindow.passed", { bossId: "boss.crystal_crab", windowId: "crystalCrab.activePincer", seat: actor.seat });
    const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); validateAuthoritativeState(committed.state); this.#state = committed.state; const result = { accepted: true as const, commandId: command.commandId, previousRevision: committed.previousRevision, stateRevision: committed.state.stateRevision, events: committed.events }; this.#results.set(command.commandId, result); return structuredClone(result);
  }
  handleTimeout(commandId: string): CrabPincerResult { const window = this.#state.pendingWindows.find((item) => item.kind === "crystalCrabActivePincer"); if (!window) return { accepted: false, commandId, stateRevision: this.#state.stateRevision, reasonCode: "PROMPT_CLOSED", refreshRequired: true }; const actor = this.#state.players.find((item) => item.seat === window.prioritySeat)!; return this.handle({ commandId, gameId: this.#state.gameId, expectedStateRevision: this.#state.stateRevision, actorUserId: actor.userId, promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))! }); }
}
