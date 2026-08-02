import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
import { continuePendingDarkKnightFinalStrike } from "./darkKnightFinalStrike.js";
import { calculateEffectiveDistance } from "./distance.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { DomainEvent } from "./types.js";
type AttackRecord = Record<string, JsonValue>;
const records = (value: JsonValue | undefined): AttackRecord[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is AttackRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
function cleanupCards(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    refs = [
      ...new Set([
        ...(Array.isArray(attack.killCardRefs)
          ? attack.killCardRefs.filter(
              (ref): ref is string => typeof ref === "string",
            )
          : []),
        ...(Array.isArray(attack.costCardRefs)
          ? attack.costCardRefs.filter(
              (ref): ref is string => typeof ref === "string",
            )
          : []),
      ]),
    ];
  for (const ref of refs) {
    const card = draft.cards[ref];
    if (!card || card.zoneRef !== "resolving") continue;
    const zone = draft.zones.resolving!,
      index = zone.orderedCardRefs.indexOf(ref);
    if (index >= 0) zone.orderedCardRefs.splice(index, 1);
    draft.zones.discardPile!.orderedCardRefs.push(ref);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.moved", {
      cardRef: ref,
      fromZoneRef: "resolving",
      toZoneRef: "discardPile",
      moveKind: "systemMove",
    });
  }
}
function removeDeferredArmor(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const ref =
    typeof attack.removeArmorAfterAttackRef === "string"
      ? attack.removeArmorAfterAttackRef
      : null;
  if (!ref) return;
  const card = tx.draft.cards[ref];
  if (!card || !card.zoneRef.startsWith("armor:")) return;
  const zone = tx.draft.zones[card.zoneRef]!,
    index = zone.orderedCardRefs.indexOf(ref);
  if (index < 0) return;
  const fromZoneRef = card.zoneRef;
  zone.orderedCardRefs.splice(index, 1);
  tx.draft.zones.outsideDeck!.orderedCardRefs.push(ref);
  card.zoneRef = "outsideDeck";
  card.ownerSeat = null;
  card.controllerSeat = null;
  card.faceUp = true;
  tx.emit("card.lost", {
    cardRef: ref,
    lostFamilyId: card.templateId,
    ownerSeat: zone.ownerSeat,
    seat: zone.ownerSeat,
    fromZoneRef,
    fromZoneType: zone.zoneType,
    toZoneRef: "outsideDeck",
    moveKind: "remove",
    reason: "durabilityDepletedAfterCounterattack",
  });
}
function valid(state: AuthoritativeGameState, attack: AttackRecord): boolean {
  const source = state.players.find(
      (item) => item.seat === Number(attack.attackerSeat),
    ),
    targetRef = Array.isArray(attack.targetRefs) ? attack.targetRefs[0] : null,
    target = state.players.find(
      (item) => `character:${item.seat}` === targetRef,
    );
  return Boolean(
    source &&
    target &&
    source.lifeState !== "eliminated" &&
    source.presence === "inPlay" &&
    target.lifeState !== "eliminated" &&
    target.presence === "inPlay",
  );
}
function restorePlay(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    deadline = attack.resumePlayDeadlineAt,
    seat = Number(attack.rootAttackerSeat ?? attack.attackerSeat) as Seat;
  if (typeof deadline !== "number" || draft.lifecycle !== "inProgress") return;
  const kind = "playPhaseAction",
    promptId = `prompt:${kind}:${draft.round}:${seat}:${draft.stateRevision + 1}`;
  draft.pendingWindows.push({
    promptId,
    kind,
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: deadline,
    timeoutPolicy: "pass",
    legalOfferIds: [`offer:${kind}:finish`],
    context: {},
  });
  tx.emit("choice.requested", { seat, kind, resumedAfterAttack: true });
}
function openParticleEagleFollowUp(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): boolean {
  if (
    attack.weaponId !== "weapon.w07" ||
    attack.currentTargetHit !== false ||
    attack.particleEagleFollowUpResolved === true ||
    (Array.isArray(attack.tags) && attack.tags.includes("particleEagleFollowUp"))
  ) return false;
  const attackerSeat = Number(attack.attackerSeat) as Seat;
  const originalRef = Array.isArray(attack.targetRefs) && typeof attack.targetRefs[0] === "string" ? attack.targetRefs[0] : null;
  if (!originalRef) return false;
  const originalSeat = Number(originalRef.split(":")[1]) as Seat;
  const legalTargetRefs = tx.draft.players.filter((player) =>
    `character:${player.seat}` !== originalRef &&
    player.presence === "inPlay" && player.lifeState !== "eliminated" &&
    calculateEffectiveDistance(tx.draft, attackerSeat, player.seat) <= Number(attack.range) &&
    calculateEffectiveDistance(tx.draft, originalSeat, player.seat) <= 1,
  ).map((player) => `character:${player.seat}`);
  attack.particleEagleFollowUpResolved = true;
  if (!legalTargetRefs.length) return false;
  const promptId = `prompt:weapon-w07-follow-up:${String(attack.attackId)}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({ promptId, kind: "weaponParticleEagleFollowUp", prioritySeat: attackerSeat, mandatory: false, deadlineAt: Number(attack.resumePlayDeadlineAt ?? 0), timeoutPolicy: "pass", legalOfferIds: ["offer:weapon-w07-follow-up:pass", ...legalTargetRefs.map((ref) => `offer:weapon-w07-follow-up:${ref}`)], context: { attackId: String(attack.attackId), legalTargetRefs } });
  attack.status = "awaitingParticleEagleFollowUp";
  tx.emit("choice.requested", { kind: "weaponParticleEagleFollowUp", promptId, seat: attackerSeat, legalTargetRefs });
  return true;
}
export function finalizeCurrentAttack(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    attackId = String(attack.attackId);
  if (
    attack.pendingOwlTrigger &&
    typeof attack.pendingOwlTrigger === "object" &&
    !Array.isArray(attack.pendingOwlTrigger)
  ) {
    attack.status = "awaitingOwlTrigger";
    tx.emit("attack.paused", { attackId, reason: "talent.owl.pending" });
    return;
  }
  if (openParticleEagleFollowUp(tx, attack)) return;
  tx.emit("attack.after", { attackId });
  tx.emit("attack.resolved", { attackId });
  cleanupCards(tx, attack);
  removeDeferredArmor(tx, attack);
  const own = records(attack.afterAttackQueue),
    outer = records(attack.continuationQueue),
    candidates = [
      ...own.map((value, index) => ({
        value,
        remainder: [...own.slice(index + 1), ...outer],
      })),
      ...outer.map((value, index) => ({
        value,
        remainder: outer.slice(index + 1),
      })),
    ];
  let selected: { value: AttackRecord; remainder: AttackRecord[] } | undefined;
  for (const candidate of candidates) {
    if (valid(draft, candidate.value)) {
      selected = candidate;
      break;
    }
    tx.emit("attack.queued.skipped", {
      attackId: String(candidate.value.attackId),
      reason: "sourceOrTargetUnavailable",
    });
    removeDeferredArmor(tx, candidate.value);
  }
  if (selected) {
    const next = structuredClone(selected.value);
    next.continuationQueue = selected.remainder as unknown as JsonValue;
    next.resumePlayDeadlineAt =
      typeof attack.resumePlayDeadlineAt === "number"
        ? attack.resumePlayDeadlineAt
        : null;
    next.rootAttackerSeat =
      typeof attack.rootAttackerSeat === "number"
        ? attack.rootAttackerSeat
        : Number(attack.attackerSeat);
    if (attack.goldenMaskReplacement && !next.goldenMaskReplacement)
      next.goldenMaskReplacement = structuredClone(
        attack.goldenMaskReplacement,
      );
    if (
      typeof next.launchCounterMarkerSeat === "number" &&
      typeof next.launchCounterMarkerId === "string"
    ) {
      const owner = draft.players.find(
        (item) => item.seat === next.launchCounterMarkerSeat,
      );
      if (owner) {
        const prior =
          typeof owner.markers[next.launchCounterMarkerId] === "number"
            ? (owner.markers[next.launchCounterMarkerId] as number)
            : 0;
        owner.markers[next.launchCounterMarkerId] = prior + 1;
        tx.emit("counter.changed", {
          seat: owner.seat,
          counterId: next.launchCounterMarkerId,
          from: prior,
          to: prior + 1,
          reason: "queuedAttackCommitted",
        });
      }
    }
    draft.combat.attack = next;
    draft.combat.targetQueue = Array.isArray(next.targetRefs)
      ? next.targetRefs.filter((ref): ref is string => typeof ref === "string")
      : [];
    draft.combat.currentTargetRef = draft.combat.targetQueue[0] ?? null;
    tx.emit("attack.queued.started", {
      attackId: String(next.attackId),
      parentAttackId: attackId,
    });
    return;
  }
  if (attack.demonNatureRewardPending === true) {
    const source=draft.players.find((item)=>item.seat===Number(attack.attackerSeat));
    if(source&&source.lifeState!=="eliminated"&&source.presence==="inPlay"){
      const hpRecovery=Number(attack.demonNatureHpRecovery??0),maxShieldGain=Number(attack.demonNatureMaxShieldGain??0),beforeHp=source.hp,beforeShield=source.shield;
      if(source.hp!==null&&source.maxHp!==null)source.hp=Math.min(source.maxHp,source.hp+hpRecovery);
      if(source.maxShield!==null){source.maxShield+=maxShieldGain;if(source.shield!==null)source.shield=Math.min(source.maxShield,source.shield+maxShieldGain)}
      tx.emit("ability.reward.applied",{seat:source.seat,abilityId:"skill.demonmancer.demonic_nature",hpRecovered:beforeHp===null||source.hp===null?0:source.hp-beforeHp,maxShieldGain,shieldRecovered:beforeShield===null||source.shield===null?0:source.shield-beforeShield});
    }else tx.emit("ability.reward.cancelled",{abilityId:"skill.demonmancer.demonic_nature",reason:"sourceEliminatedOrOffField"});
  }
  draft.combat.attack = null;
  draft.combat.targetQueue = [];
  draft.combat.currentTargetRef = null;
  if (continuePendingDarkKnightFinalStrike(tx, attack)) return;
  if (
    attack.goldenMaskReplacement &&
    typeof attack.goldenMaskReplacement === "object" &&
    !Array.isArray(attack.goldenMaskReplacement)
  ) {
    const context = attack.goldenMaskReplacement as Record<string, JsonValue>;
    draft.scheduledEffects.push({
      scheduledId: `scheduled:golden-mask-complete:${attackId}`,
      sourceRef: typeof attack.weaponRef === "string" ? attack.weaponRef : null,
      controllerSeat: Number(context.seat) as Seat,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "completeGoldenMaskReplacement",
        seat: Number(context.seat),
        phase: String(context.phase),
        deadlineAt: Number(context.deadlineAt ?? 0),
      },
      cancelled: false,
    });
    return;
  }
  restorePlay(tx, attack);
}

export interface ParticleEagleCommand { commandId: string; gameId: string; expectedStateRevision: number; actorUserId: string; promptId: string; offerId: string; targetRef?: string }
export type ParticleEagleResult = { accepted: true; commandId: string; previousRevision: number; stateRevision: number; events: DomainEvent[] } | { accepted: false; commandId: string; stateRevision: number; reasonCode: string; refreshRequired: boolean };
export class ParticleEagleFollowUpSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, ParticleEagleResult>();
  constructor(state: AuthoritativeGameState) { this.#state = state; }
  get state() { return this.#state; }
  handle(command: ParticleEagleCommand): ParticleEagleResult {
    const prior = this.#results.get(command.commandId); if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean): ParticleEagleResult => { const result = { accepted: false as const, commandId: command.commandId, stateRevision: this.#state.stateRevision, reasonCode, refreshRequired }; this.#results.set(command.commandId, result); return structuredClone(result); };
    if (command.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision) return reject("STALE_REVISION", true);
    const window = this.#state.pendingWindows.find((item) => item.kind === "weaponParticleEagleFollowUp" && item.promptId === command.promptId);
    const actor = this.#state.players.find((item) => item.userId === command.actorUserId);
    if (!window || !actor || actor.seat !== window.prioritySeat) return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId)) return reject("OFFER_EXPIRED", true);
    const pass = command.offerId.endsWith(":pass"), legal = Array.isArray(window.context?.legalTargetRefs) ? window.context.legalTargetRefs : [];
    if (!pass && (!command.targetRef || !legal.includes(command.targetRef) || command.offerId !== `offer:weapon-w07-follow-up:${command.targetRef}`)) return reject("TARGET_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state), attack = tx.draft.combat.attack as AttackRecord;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter((item) => item.promptId !== window.promptId);
    if (!pass) {
      const follow = structuredClone(attack);
      follow.attackId = `attack:w07-follow-up:${String(attack.attackId)}`;
      follow.targetRefs = [command.targetRef!]; follow.killCardRefs = []; follow.status = "committed";
      follow.tags = [...(Array.isArray(attack.tags) ? attack.tags : []), "particleEagleFollowUp"];
      follow.resumePlayDeadlineAt = null;
      for (const key of ["currentTargetHit", "currentTargetResult", "currentTargetDamage", "particleEagleFollowUpResolved", "judgmentResults", "pendingJudgmentEffects"]) delete follow[key];
      attack.afterAttackQueue = [...records(attack.afterAttackQueue), follow] as unknown as JsonValue;
      tx.emit("attack.followUp.queued", { parentAttackId: String(attack.attackId), attackId: String(follow.attackId), weaponId: "weapon.w07", targetRef: command.targetRef! });
    }
    finalizeCurrentAttack(tx, attack);
    const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); validateAuthoritativeState(committed.state); this.#state = committed.state;
    const result = { accepted: true as const, commandId: command.commandId, previousRevision: command.expectedStateRevision, stateRevision: committed.state.stateRevision, events: committed.events }; this.#results.set(command.commandId, result); return structuredClone(result);
  }
  handleTimeout(commandId: string): ParticleEagleResult { const window = this.#state.pendingWindows.find((item) => item.kind === "weaponParticleEagleFollowUp")!; const actor = this.#state.players.find((item) => item.seat === window.prioritySeat)!; return this.handle({ commandId, gameId: this.#state.gameId, expectedStateRevision: this.#state.stateRevision, actorUserId: actor.userId, promptId: window.promptId, offerId: "offer:weapon-w07-follow-up:pass" }); }
}
