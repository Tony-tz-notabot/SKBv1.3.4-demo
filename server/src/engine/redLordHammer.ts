import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateTargetOffer } from "./targets.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { createCompositeScriptedAttackInTransaction, type ScriptedAttackTargetGroup } from "./scriptedAttack.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

const activeRed = (state: AuthoritativeGameState, seat: Seat) => { const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0], card = ref ? state.cards[ref] : undefined; return card?.templateId === "boss.red_lord" && card.runtime.active === true ? card : undefined; };
const legalTargets = (state: AuthoritativeGameState, seat: Seat) => calculateTargetOffer(state, seat, { kind: "character", min: 0, max: 1, distinct: true, includeSelf: true, team: "any", presence: "inPlay", maxDistance: 4 }).legalTargetRefs;

export function openRedLordHammerWindow(tx: EngineTransaction<AuthoritativeGameState>, ruleset: LoadedRuleset, seat: Seat, deadlineAt: number): void {
  const card = activeRed(tx.draft, seat), ordinal = Number(card?.runtime.ownerTurnOrdinal ?? 0), marker = `sealingHammerWindowResolved.${ordinal}`;
  if (!card || ![1, 2].includes(ordinal) || card.runtime[marker] === true) return;
  card.runtime[marker] = true;
  const targets = legalTargets(tx.draft, seat), promptId = `prompt:red-hammer:${card.cardRef}:${ordinal}`;
  tx.draft.pendingWindows.push({ promptId, kind: "redLordSealingHammer", prioritySeat: seat, mandatory: false, deadlineAt, timeoutPolicy: "pass", legalOfferIds: [`offer:red-hammer:pass:${card.cardRef}:${ordinal}`, `offer:red-hammer:activate:${card.cardRef}:${ordinal}`], context: { cardRef: card.cardRef, ordinal, legalMeleeTargetRefs: targets, legalLaserTargetRefs: targets } });
  tx.emit("choice.requested", { kind: "redLordSealingHammer", promptId, seat, cardRef: card.cardRef, ordinal, legalMeleeTargetRefs: targets, legalLaserTargetRefs: targets });
}
export interface RedHammerCommand { commandId: string; gameId: string; expectedStateRevision: number; actorUserId: string; promptId: string; offerId: string; meleeTargetRef?: string; laserTargetRef?: string; }
export type RedHammerResult = { accepted: true; commandId: string; previousRevision: number; stateRevision: number; events: DomainEvent[] } | { accepted: false; commandId: string; stateRevision: number; reasonCode: string; refreshRequired: boolean };
export class RedLordHammerSession {
  #state: AuthoritativeGameState; readonly #results = new Map<string, RedHammerResult>();
  constructor(state: AuthoritativeGameState, private readonly ruleset: LoadedRuleset) { this.#state = state; }
  get state() { return this.#state; }
  handle(command: RedHammerCommand): RedHammerResult {
    const prior = this.#results.get(command.commandId); if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean): RedHammerResult => { const result = { accepted: false as const, commandId: command.commandId, stateRevision: this.#state.stateRevision, reasonCode, refreshRequired }; this.#results.set(command.commandId, result); return structuredClone(result); };
    if (command.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision) return reject("STALE_REVISION", true);
    const window = this.#state.pendingWindows.find((item) => item.kind === "redLordSealingHammer");
    if (!window || window.promptId !== command.promptId) return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find((item) => item.userId === command.actorUserId);
    if (!actor || actor.seat !== window.prioritySeat) return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId)) return reject("OFFER_EXPIRED", true);
    const activate = command.offerId.includes(":activate:");
    if (!activate && (command.meleeTargetRef || command.laserTargetRef)) return reject("TARGET_INVALID", false);
    if (activate) {
      const legal = legalTargets(this.#state, actor.seat);
      if ((command.meleeTargetRef && !legal.includes(command.meleeTargetRef)) || (command.laserTargetRef && !legal.includes(command.laserTargetRef))) return reject("TARGET_NO_LONGER_LEGAL", true);
      if (command.meleeTargetRef && command.meleeTargetRef === command.laserTargetRef) return reject("TARGETS_NOT_DISTINCT", false);
    }
    const tx = new EngineTransaction(this.#state); tx.draft.pendingWindows = tx.draft.pendingWindows.filter((item) => item.promptId !== window.promptId);
    if (activate) {
      const cardRef = String(window.context?.cardRef), card = activeRed(tx.draft, actor.seat); if (!card || card.cardRef !== cardRef) return reject("BOSS_NO_LONGER_ACTIVE", true);
      const groups: ScriptedAttackTargetGroup[] = [];
      if (command.meleeTargetRef) groups.push({ targetRef: command.meleeTargetRef, attackTypes: ["melee"], damageSegments: [{ segmentId: "sealingHammerMelee", deliveryType: "attack", attackType: "melee", damageType: "normal", element: "none", amount: 3, repeat: 1, isAdditional: false, overflowPolicy: "normal" }] });
      if (command.laserTargetRef) groups.push({ targetRef: command.laserTargetRef, attackTypes: ["laser"], cannotMeleeBlock: true, damageSegments: [{ segmentId: "sealingHammerLaser", deliveryType: "attack", attackType: "laser", damageType: "normal", element: "none", amount: 3, repeat: 1, isAdditional: false, overflowPolicy: "normal" }] });
      if (groups.length) createCompositeScriptedAttackInTransaction(tx, { attackId: `attack:red-hammer:${cardRef}:${String(window.context?.ordinal)}`, attackerSeat: actor.seat, sourceRef: cardRef, weaponId: "boss.red_lord.sealingHammer", modeId: "sealingHammer", range: 4, targetGroups: groups, tags: ["bossAttack", "redLordSealingHammer"] });
      else tx.emit("boss.specialWindow.resolved", { bossId: "boss.red_lord", windowId: "redLord.sealingHammer", seat: actor.seat, selectedTargets: [] });
    } else tx.emit("boss.specialWindow.passed", { bossId: "boss.red_lord", windowId: "redLord.sealingHammer", seat: actor.seat });
    const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); validateAuthoritativeState(committed.state); this.#state = committed.state;
    const result = { accepted: true as const, commandId: command.commandId, previousRevision: committed.previousRevision, stateRevision: committed.state.stateRevision, events: committed.events }; this.#results.set(command.commandId, result); return structuredClone(result);
  }
  handleTimeout(commandId: string): RedHammerResult { const window = this.#state.pendingWindows.find((item) => item.kind === "redLordSealingHammer"); if (!window) return { accepted: false, commandId, stateRevision: this.#state.stateRevision, reasonCode: "PROMPT_CLOSED", refreshRequired: true }; const actor = this.#state.players.find((item) => item.seat === window.prioritySeat)!; return this.handle({ commandId, gameId: this.#state.gameId, expectedStateRevision: this.#state.stateRevision, actorUserId: actor.userId, promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))! }); }
}
