import type { LoadedRuleset } from "../ruleset/types.js";
import {
  clearBerserkerDrawResolution,
  openBerserkerRageWindow,
} from "./berserkerRage.js";
import { drawCardsInTransaction } from "./deck.js";
import {
  calculateDrawCount,
  consumeDrawCountModifiersAfterDraw,
} from "./drawCount.js";
import { requiredDiscardCount } from "./handLimit.js";
import { EngineTransaction } from "./transaction.js";
import { handCards, type AuthoritativeGameState } from "./state.js";
import {
  applyShopDiscountAtDraw,
  tickShopDiscountCooldownAtPrepare,
} from "./shopDiscount.js";
import { canUseSpartanKick } from "./spartanKick.js";
import { openForesightDrawWindow } from "./foresight.js";
import { tickGeneralMortarCooldownAtPrepare } from "./general.js";
import type { TransactionCommit } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { openSuperBabyAtJudgment } from "./superBaby.js";
import { hasDemonmancerShieldRecoveryRestriction, tickDemonmancerPrepareDurations } from "./demonmancer.js";
import { tickMeteorCooldownAtPrepareInTransaction } from "./meteorWeapon.js";
import { openEngineerStatueAtJudgment } from "./statueEffects.js";
export function resolvePhaseBody(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  deadlineAt: number,
  turnDeadlineAt: (() => number) | undefined = undefined,
): TransactionCommit<AuthoritativeGameState> {
  if (
    state.lifecycle !== "inProgress" ||
    state.phaseBoundary !== "body" ||
    state.phaseBodyResolved ||
    !state.activeSeat ||
    !state.phase
  )
    throw new Error("PHASE_BODY_NOT_RESOLVABLE");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    seat = draft.activeSeat!,
    player = draft.players.find((item) => item.seat === seat)!,
    playDeadline = turnDeadlineAt ? turnDeadlineAt() : deadlineAt;
  if (draft.phase === "prepare") {
    if (player.markers["demonmancer.prepareDurationsTicked"] !== true)
      tickDemonmancerPrepareDurations(tx, seat);
    const shieldRecoveryRestricted = hasDemonmancerShieldRecoveryRestriction(draft, seat);
    delete player.markers["demonmancer.prepareDurationsTicked"];
    delete player.markers["demonmancer.skipShieldRecoveryThisPrepare"];
    tickGeneralMortarCooldownAtPrepare(tx, seat);
    tickMeteorCooldownAtPrepareInTransaction(tx, seat);
    tickShopDiscountCooldownAtPrepare(tx, seat);
    player.limits[ruleset.settings.combat.attackCountLimitId] =
      ruleset.settings.defaultAttackCount;
    tx.emit("limit.reset", {
      seat,
      limitId: ruleset.settings.combat.attackCountLimitId,
      value: ruleset.settings.defaultAttackCount,
    });
    if (player.markers.defyFateUsed === true) {
      delete player.markers.defyFateUsed;
      tx.emit("limit.reset", {
        seat,
        limitId: "skill.shaman.defy_fate",
        value: 1,
      });
    }
    if (player.markers.refinedStaffUsed === true) {
      delete player.markers.refinedStaffUsed;
      tx.emit("limit.reset", {
        seat,
        limitId: "armor.a06.firstHitRangedAttackPerOwnerRound",
        value: 1,
      });
    }
    if (player.markers.shieldBroken === true) {
      delete player.markers.shieldBroken;
      tx.emit("marker.removed", { seat, markerId: "shieldBroken" });
    } else if (
      !shieldRecoveryRestricted &&
      player.shield !== null &&
      player.maxShield !== null &&
      player.shield < player.maxShield
    ) {
      player.shield += 1;
      tx.emit("shield.recovered", { seat, amount: 1, shield: player.shield });
    }
    draft.phaseBodyResolved = true;
  } else if (draft.phase === "judgment") {
    const cards = draft.zones[`judgment:${seat}`]!.orderedCardRefs;
    if (openEngineerStatueAtJudgment(tx, ruleset, seat, deadlineAt)) {
      // The engineer statue owns this judgment body until its branch resolves.
    } else if (openSuperBabyAtJudgment(tx, ruleset, seat, deadlineAt)) {
      // Delayed special-card resolution owns this judgment body until cleanup.
    } else if (cards.length) {
      draft.resolutionStack.push({
        frameId: `judgment:${draft.stateRevision + 1}:${seat}`,
        frameType: "judgment",
        sourceRef: cards[0]!,
        controllerSeat: seat,
        context: {},
      });
      tx.emit("judgment.requested", { seat, cardRef: cards[0]! });
    } else draft.phaseBodyResolved = true;
  } else if (draft.phase === "draw") {
    if (openBerserkerRageWindow(tx, ruleset, seat, deadlineAt)) {
      const committed = tx.commit();
      committed.state.history.domainEvents.push(...committed.events);
      validateAuthoritativeState(committed.state);
      return committed;
    }
    applyShopDiscountAtDraw(tx, ruleset, seat);
    const count = calculateDrawCount(
      draft,
      seat,
      ruleset.settings.defaultDrawCount,
    );
    tx.emit("draw.count.calculated", {
      seat,
      baseCount: count.baseCount,
      rawCount: count.rawCount,
      actualCount: count.actualCount,
      modifiers: count.modifiers as unknown as import("./types.js").JsonValue,
    });
    if (
      openForesightDrawWindow(tx, ruleset, seat, count.actualCount, deadlineAt)
    ) {
      const committed = tx.commit();
      committed.state.history.domainEvents.push(...committed.events);
      validateAuthoritativeState(committed.state);
      return committed;
    }
    drawCardsInTransaction(tx, seat, count.actualCount, "phase.draw");
    consumeDrawCountModifiersAfterDraw(tx, seat);
    clearBerserkerDrawResolution(tx, seat);
    draft.phaseBodyResolved = true;
  } else if (draft.phase === "play") {
    const kind = "playPhaseAction";
    draft.pendingWindows.push({
      promptId: `prompt:${kind}:${draft.round}:${seat}`,
      kind,
      prioritySeat: seat,
      mandatory: false,
      deadlineAt: playDeadline,
      timeoutPolicy: "pass",
      legalOfferIds: [`offer:${kind}:finish`],
      context: {},
    });
    tx.emit("choice.requested", { seat, kind });
  } else if (draft.phase === "discard") {
    const count = requiredDiscardCount(draft, seat);
    const spartanKick = canUseSpartanKick(draft, seat);
    if (count === 0 && !spartanKick) draft.phaseBodyResolved = true;
    else {
      const kind = "discardPhaseAction";
      draft.pendingWindows.push({
        promptId: `prompt:${kind}:${draft.round}:${seat}`,
        kind,
        prioritySeat: seat,
        mandatory: count > 0,
        deadlineAt: playDeadline,
        timeoutPolicy: "randomLegal",
        legalOfferIds: [
          ...(count > 0 ? [`offer:${kind}:submit`] : [`offer:${kind}:finish`]),
          ...(spartanKick ? ["offer:skill.headtaker.spartan_kick"] : []),
        ],
        context: {
          requiredCount: count,
          legalCardRefs: [...handCards(draft, seat)],
        },
      });
      tx.emit("choice.requested", { seat, kind, requiredCount: count });
    }
  } else draft.phaseBodyResolved = true;
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
export function finishManualPhase(
  state: AuthoritativeGameState,
): TransactionCommit<AuthoritativeGameState> {
  if (
    state.phaseMode !== "manual" ||
    state.phaseBoundary !== "body" ||
    state.phaseBodyResolved ||
    !state.activeSeat
  )
    throw new Error("MANUAL_PHASE_NOT_ACTIVE");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    window = draft.pendingWindows.find(
      (item) =>
        item.prioritySeat === draft.activeSeat &&
        item.kind === "playPhaseAction",
    );
  if (!window) throw new Error("MANUAL_PHASE_WINDOW_MISSING");
  draft.pendingWindows = draft.pendingWindows.filter(
    (item) => item.promptId !== window.promptId,
  );
  draft.phaseBodyResolved = true;
  tx.emit("choice.resolved", {
    seat: draft.activeSeat,
    kind: window.kind,
    result: "finish",
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
