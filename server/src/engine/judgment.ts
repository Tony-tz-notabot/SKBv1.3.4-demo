import type { LoadedRuleset } from "../ruleset/types.js";
import { ensureDrawPileInTransaction } from "./deck.js";
import { continueGoldenMaskAfterJudgmentInTransaction } from "./goldenMask.js";
import { continueInternetArmorJudgmentInTransaction } from "./internetAddiction.js";
import { facts, findShaman, sameColorRefs } from "./judgmentShared.js";
import { continueSheepArmorJudgmentInTransaction } from "./sheep.js";
import { openStatueResolutionFromJudgment } from "./statueDoubleTrigger.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";

export type PrintedColor = "white" | "green" | "blue" | "orange" | "red";
export interface BeginJudgmentInput {
  controllerSeat: Seat;
  sourceRef: string | null;
  purpose: string;
  matchColors: PrintedColor[];
  context?: Record<string, JsonValue>;
}
const commit = (tx: EngineTransaction<AuthoritativeGameState>) => {
  const result = tx.commit();
  result.state.history.domainEvents.push(...result.events);
  validateAuthoritativeState(result.state);
  return result;
};
function revealIntoFrame(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  frame: Record<string, JsonValue>,
  eventType: "judgment.card.revealed" | "judgment.replaced",
): void {
  const draft = tx.draft,
    judgmentId = String(frame.judgmentId);
  if (!ensureDrawPileInTransaction(tx, "judgment", { judgmentId })) {
    frame.cardRef = null;
    frame.printedColor = null;
    frame.finalColor = null;
    frame.status = "noCard";
    tx.emit(eventType, { judgmentId, cardRef: null, printedColor: null });
    return;
  }
  const cardRef = draft.zones.drawPile!.orderedCardRefs.shift()!,
    card = draft.cards[cardRef]!,
    color = facts(ruleset).get(card.templateId)?.color;
  if (!color) throw new Error("JUDGMENT_CARD_COLOR_MISSING");
  draft.zones.resolving!.orderedCardRefs.push(cardRef);
  card.zoneRef = "resolving";
  card.ownerSeat = null;
  card.controllerSeat = null;
  card.faceUp = true;
  frame.cardRef = cardRef;
  frame.printedColor = color;
  frame.finalColor = color;
  frame.status = "intervention";
  tx.emit(eventType, {
    judgmentId,
    cardRef,
    templateId: card.templateId,
    printedColor: color,
    purpose: String(frame.purpose),
  });
}
function openInterventionWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  context: Record<string, JsonValue>,
  deadlineAt: number,
  shamanSeat: Seat,
): void {
  const draft = tx.draft,
    judgmentId = String(context.judgmentId),
    promptId = `prompt:judgment-intervention:${judgmentId}:${draft.stateRevision + 1}`;
  draft.pendingWindows = draft.pendingWindows.filter(
    (item) => item.kind !== "judgmentIntervention",
  );
  draft.pendingWindows.push({
    promptId,
    kind: "judgmentIntervention",
    prioritySeat: shamanSeat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:judgment-intervention:pass:${judgmentId}`,
      ...(context.replaced === true
        ? []
        : [`offer:judgment-intervention:replace:${judgmentId}`]),
    ],
    context: { judgmentId, shamanSeat, replaced: context.replaced === true },
  });
  tx.emit("response.window.opened", {
    kind: "judgmentIntervention",
    judgmentId,
    promptId,
    prioritySeat: shamanSeat,
  });
  tx.emit("response.priority.granted", {
    kind: "judgmentIntervention",
    judgmentId,
    seat: shamanSeat,
  });
}
export function beginJudgment(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: BeginJudgmentInput,
  deadlineAt = 0,
): TransactionCommit<AuthoritativeGameState> {
  const tx = new EngineTransaction(state);
  beginJudgmentInTransaction(tx, ruleset, input, deadlineAt);
  return commit(tx);
}
export function beginJudgmentInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: BeginJudgmentInput,
  deadlineAt = 0,
): void {
  const draft = tx.draft,
    judgmentId = `judgment:${draft.stateRevision + 1}:${input.controllerSeat}`,
    context: Record<string, JsonValue> = {
      ...(input.context ?? {}),
      judgmentId,
      purpose: input.purpose,
      controllerSeat: input.controllerSeat,
      matchColors: [...input.matchColors],
      cardRef: null,
      printedColor: null,
      finalColor: null,
      status: "requested",
      interventionDeadlineAt: deadlineAt,
    };
  draft.resolutionStack.push({
    frameId: judgmentId,
    frameType: "judgment",
    sourceRef: input.sourceRef,
    controllerSeat: input.controllerSeat,
    context,
  });
  if (
    typeof context.attackId === "string" &&
    draft.combat.attack &&
    typeof draft.combat.attack === "object" &&
    !Array.isArray(draft.combat.attack)
  )
    (draft.combat.attack as Record<string, JsonValue>).status =
      "awaitingJudgment";
  tx.emit("judgment.requested", {
    judgmentId,
    controllerSeat: input.controllerSeat,
    sourceRef: input.sourceRef,
    purpose: input.purpose,
  });
  revealIntoFrame(tx, ruleset, context, "judgment.card.revealed");
  const shaman = findShaman(tx.draft);
  if (shaman === null) {
    finalizeJudgmentInTransaction(tx, context);
    if (context.goldenMaskReplacement === true)
      continueGoldenMaskAfterJudgmentInTransaction(
        tx,
        ruleset,
        context,
        context.finalColor as PrintedColor | null,
      );
    if (context.specialInternetArmorJudgment === true) {
      const colors = Array.isArray(context.matchColors)
          ? context.matchColors
          : [],
        finalColor =
          typeof context.finalColor === "string"
            ? context.finalColor
            : null,
        matched = finalColor !== null && colors.includes(finalColor);
      continueInternetArmorJudgmentInTransaction(
        tx,
        ruleset,
        context,
        matched,
        deadlineAt,
      );
    }
    if (context.specialSheepArmorJudgment === true) {
      const colors = Array.isArray(context.matchColors)
          ? context.matchColors
          : [],
        finalColor =
          typeof context.finalColor === "string"
            ? context.finalColor
            : null,
        matched = finalColor !== null && colors.includes(finalColor);
      continueSheepArmorJudgmentInTransaction(
        tx,
        ruleset,
        context,
        matched,
        deadlineAt,
      );
    }
    return;
  }
  openInterventionWindow(tx, context, deadlineAt, shaman);
}
export function beginDesignatedJudgmentChoice(
  state: AuthoritativeGameState,
  input: BeginJudgmentInput,
  deadlineAt = 0,
  designationColors: PrintedColor[] = input.matchColors,
): TransactionCommit<AuthoritativeGameState> {
  if (!designationColors.length)
    throw new Error("JUDGMENT_DESIGNATION_HAS_NO_OPTIONS");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    judgmentId = `judgment:${draft.stateRevision + 1}:${input.controllerSeat}`,
    context: Record<string, JsonValue> = {
      ...(input.context ?? {}),
      judgmentId,
      purpose: input.purpose,
      controllerSeat: input.controllerSeat,
      matchColors: [...input.matchColors],
      cardRef: null,
      printedColor: null,
      finalColor: null,
      status: "designationChoice",
      designatedWithoutCard: true,
    };
  draft.resolutionStack.push({
    frameId: judgmentId,
    frameType: "judgment",
    sourceRef: input.sourceRef,
    controllerSeat: input.controllerSeat,
    context,
  });
  if (
    typeof context.attackId === "string" &&
    draft.combat.attack &&
    typeof draft.combat.attack === "object" &&
    !Array.isArray(draft.combat.attack)
  )
    (draft.combat.attack as Record<string, JsonValue>).status =
      "awaitingJudgment";
  const promptId = `prompt:judgment-designation:${judgmentId}`;
  draft.pendingWindows.push({
    promptId,
    kind: "judgmentDesignation",
    prioritySeat: input.controllerSeat,
    mandatory: true,
    deadlineAt,
    timeoutPolicy: "randomLegal",
    legalOfferIds: designationColors.map(
      (color) => `offer:judgment-designation:${color}:${judgmentId}`,
    ),
    context: { judgmentId, legalColors: [...designationColors] },
  });
  tx.emit("judgment.requested", {
    judgmentId,
    controllerSeat: input.controllerSeat,
    sourceRef: input.sourceRef,
    purpose: input.purpose,
    designatedWithoutCard: true,
  });
  tx.emit("choice.requested", {
    kind: "judgmentDesignation",
    judgmentId,
    promptId,
    seat: input.controllerSeat,
    legalColors: designationColors,
  });
  return commit(tx);
}
export function replaceJudgmentCardInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  cardRefs: string[],
  deadlineAt?: number,
): void {
  const draft = tx.draft,
    draftFrame = draft.resolutionStack.at(-1)!,
    context = draftFrame.context;
  if (draftFrame.frameType !== "judgment")
    throw new Error("JUDGMENT_FRAME_MISSING");
  if (context.replaced === true)
    throw new Error("JUDGMENT_ALREADY_REPLACED");
  const shamanSeat = findShaman(draft);
  if (shamanSeat === null) throw new Error("SHAMAN_MISSING");
  if (
    cardRefs.length !== 2 ||
    new Set(cardRefs).size !== 2 ||
    cardRefs.some((ref) => !sameColorRefs(draft, ruleset, shamanSeat).includes(ref))
  )
    throw new Error("JUDGMENT_REPLACE_COST_INVALID");
  for (const ref of cardRefs) {
    const hand = draft.zones[`hand:${shamanSeat}`]!,
      index = hand.orderedCardRefs.indexOf(ref);
    hand.orderedCardRefs.splice(index, 1);
    draft.zones.discardPile!.orderedCardRefs.push(ref);
    const card = draft.cards[ref]!;
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.played", {
      cardRef: ref,
      seat: shamanSeat,
      purpose: "judgmentReplacement",
    });
  }
  tx.emit("ability.activation.committed", {
    seat: shamanSeat,
    abilityId: "skill.shaman.judgment_replace",
    cardRefs,
  });
  const oldRef = typeof context.cardRef === "string" ? context.cardRef : null;
  if (oldRef) {
    const card = draft.cards[oldRef]!;
    if (card.zoneRef !== "resolving")
      throw new Error("JUDGMENT_CARD_ZONE_INVALID");
    draft.zones.resolving!.orderedCardRefs.splice(
      draft.zones.resolving!.orderedCardRefs.indexOf(oldRef),
      1,
    );
    draft.zones.discardPile!.orderedCardRefs.push(oldRef);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.moved", {
      cardRef: oldRef,
      fromZoneRef: "resolving",
      toZoneRef: "discardPile",
      moveKind: "discard",
      reason: "judgmentReplaced",
    });
  }
  revealIntoFrame(tx, ruleset, context, "judgment.replaced");
  context.replaced = true;
  openInterventionWindow(
    tx,
    context,
    deadlineAt ?? Number(context.interventionDeadlineAt ?? 0),
    shamanSeat,
  );
}
export function replaceJudgmentCard(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  cardRefs: string[] = [],
  deadlineAt?: number,
): TransactionCommit<AuthoritativeGameState> {
  const frame = state.resolutionStack.at(-1);
  if (!frame || frame.frameType !== "judgment")
    throw new Error("JUDGMENT_FRAME_MISSING");
  const tx = new EngineTransaction(state);
  replaceJudgmentCardInTransaction(tx, ruleset, cardRefs, deadlineAt);
  return commit(tx);
}
export function finalizeJudgmentInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  context: Record<string, JsonValue>,
  overrideColor?: PrintedColor,
): void {
  const draft = tx.draft,
    judgmentId = String(context.judgmentId),
    cardRef = typeof context.cardRef === "string" ? context.cardRef : null,
    printedColor =
      typeof context.printedColor === "string" ? context.printedColor : null,
    finalColor = overrideColor ?? (printedColor as PrintedColor | null),
    colors = Array.isArray(context.matchColors) ? context.matchColors : [],
    matched = finalColor !== null && colors.includes(finalColor);
  context.finalColor = finalColor;
  context.status = "finalized";
  tx.emit("judgment.finalized", {
    judgmentId,
    cardRef,
    printedColor,
    finalColor,
    overridden: overrideColor !== undefined,
  });
  tx.emit(matched ? "judgment.matched" : "judgment.notMatched", {
    judgmentId,
    cardRef,
    finalColor,
    purpose: String(context.purpose),
  });
  if (
    context.statueDoubleTrigger === true &&
    typeof context.statueRef === "string" &&
    draft.cards[context.statueRef]
  ) {
    if (matched)
      draft.cards[context.statueRef]!.runtime.returnAfterStatue = true;
    tx.emit("talent.statueDoubleTrigger.judged", {
      statueRef: context.statueRef,
      matched,
      finalColor,
    });
    // 双触判定完成后继续雕像效果解析（目标选择/直接执行）
    openStatueResolutionFromJudgment(tx, context.statueRef);
  }
  if (
    typeof context.attackId === "string" &&
    draft.combat.attack &&
    typeof draft.combat.attack === "object" &&
    !Array.isArray(draft.combat.attack)
  ) {
    const attack = draft.combat.attack as Record<string, JsonValue>;
    if (context.parallelTraversalDamage === true) {
      attack.parallelTraversalPassedOccurrenceKey = String(
        context.occurrenceKey,
      );
      if (matched)
        attack.parallelTraversalPreventedOccurrenceKey = String(
          context.occurrenceKey,
        );
      attack.status = String(context.resumeAttackStatus ?? "targetHit");
      tx.emit(
        matched ? "damage.prevention.armed" : "damage.prevention.notArmed",
        {
          attackId: context.attackId,
          targetRef: String(context.targetRef),
          occurrenceKey: String(context.occurrenceKey),
          sourceId: "talent.parallel_traversal",
          finalColor,
        },
      );
    } else if (context.responseJudgment === true) {
      if (matched) {
        attack.currentTargetHit = false;
        attack.currentTargetResult = "miss";
        attack.currentTargetMissReason = "armorJudgment";
        attack.status = "targetMiss";
        tx.emit("response.resolved", {
          attackId: context.attackId,
          targetRef: String(context.targetRef),
          result: "attackMiss",
          responseKind: "armorJudgment",
          armorRef: String(context.armorRef),
        });
        tx.emit("attack.miss", {
          attackId: context.attackId,
          targetRef: String(context.targetRef),
          reason: "armorJudgment",
        });
      } else {
        attack.status = "committed";
        tx.emit("response.resolved", {
          attackId: context.attackId,
          targetRef: String(context.targetRef),
          result: "continueResponse",
          responseKind: "armorJudgment",
          armorRef: String(context.armorRef),
        });
      }
    } else {
      const results = Array.isArray(attack.judgmentResults)
        ? attack.judgmentResults
        : [];
      results.push({
        judgmentRuleId: String(context.judgmentRuleId),
        targetRef: String(context.targetRef),
        purpose: String(context.purpose),
        finalColor,
        matched,
        occurrenceKey: String(context.occurrenceKey ?? ""),
      });
      attack.judgmentResults = results;
      attack.status = String(context.resumeAttackStatus ?? "targetHit");
      const effectMap =
          context.effectsByColor &&
          typeof context.effectsByColor === "object" &&
          !Array.isArray(context.effectsByColor)
            ? (context.effectsByColor as Record<string, JsonValue>)
            : null,
        effects = effectMap
          ? finalColor !== null && Array.isArray(effectMap[finalColor])
            ? effectMap[finalColor]
            : Array.isArray(effectMap.default)
              ? effectMap.default
              : []
          : [];
      if (effects.length) {
        const pending = Array.isArray(attack.pendingJudgmentEffects)
          ? attack.pendingJudgmentEffects
          : [];
        for (const effect of effects)
          pending.push({
            effect: structuredClone(effect),
            targetRef: String(context.targetRef),
            judgmentRuleId: String(context.judgmentRuleId),
            finalColor,
            weaponJudgmentTiming: context.weaponJudgmentTiming ?? null,
          });
        attack.pendingJudgmentEffects = pending;
      }
      if (
        matched &&
        String(context.purpose).toLowerCase().includes("critical")
      ) {
        attack.critical = true;
        tx.emit("critical.determined", {
          attackId: context.attackId,
          targetRef: String(context.targetRef),
          judgmentRuleId: String(context.judgmentRuleId),
          critical: true,
          finalColor,
        });
      }
    }
  }
  if (
    context.parallelTraversalDamage === true &&
    typeof context.scheduledId === "string"
  ) {
    const scheduled = draft.scheduledEffects.find(
      (x) => x.scheduledId === context.scheduledId,
    );
    if (
      scheduled &&
      scheduled.effect &&
      typeof scheduled.effect === "object" &&
      !Array.isArray(scheduled.effect)
    ) {
      const effect = scheduled.effect as Record<string, JsonValue>;
      effect.parallelTraversalJudged = true;
      effect.parallelTraversalPrevented = matched;
      tx.emit(
        matched ? "damage.prevention.armed" : "damage.prevention.notArmed",
        {
          scheduledId: context.scheduledId,
          targetRef: String(context.targetRef),
          occurrenceKey: String(context.occurrenceKey),
          sourceId: "talent.parallel_traversal",
          finalColor,
        },
      );
    }
  }
  if (context.demonmancerHellfire === true && matched) {
    const hellfireAmount = Number(context.hellfireAmount);
    if (!Number.isInteger(hellfireAmount) || hellfireAmount < 0)
      throw new Error("DEMONMANCER_HELLFIRE_AMOUNT_INVALID");
    draft.scheduledEffects.unshift({
      scheduledId: `scheduled:demonmancer-hellfire:${String(context.attackId)}:${String(context.targetRef)}:${draft.stateRevision + 1}`,
      sourceRef: `character:${Number(context.sourceSeat)}`,
      controllerSeat: Number(context.sourceSeat) as Seat,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "createDamage",
        targetRef: String(context.targetRef),
        amount: hellfireAmount,
        damageType: "normal",
        element: "fire",
        attackType: "effect",
        deliveryType: "direct",
        isAdditional: true,
        sourceAbilityId: "talent.hellfire",
      },
      cancelled: false,
    });
    tx.emit("ability.effect.queued", {
      abilityId: "talent.hellfire",
      attackId: String(context.attackId),
      targetRef: String(context.targetRef),
      amount: hellfireAmount,
      element: "fire",
    });
  }
  if(context.anubisCurse===true){if(matched)draft.scheduledEffects.push({scheduledId:`scheduled:anubis-curse:${judgmentId}`,sourceRef:typeof context.anubisSourceRef==="string"?context.anubisSourceRef:null,controllerSeat:Number(context.controllerSeat)as Seat,executeAt:"immediate.damagePipeline",effect:{op:"applyAnubisCurse",targetRef:String(context.anubisTargetRef),sourceRef:String(context.anubisSourceRef)},cancelled:false});const remaining=Array.isArray(context.anubisRemaining)?context.anubisRemaining:[];if(remaining.length){const [next,...rest]=remaining as Array<Record<string,JsonValue>>;draft.scheduledEffects.push({scheduledId:`scheduled:anubis-judgment:${judgmentId}`,sourceRef:typeof context.anubisSourceRef==="string"?context.anubisSourceRef:null,controllerSeat:Number(String(next!.targetRef).split(":")[1])as Seat,executeAt:"immediate.damagePipeline",effect:{op:"beginAnubisJudgment",targetRef:String(next!.targetRef),colors:(next!.colors??[])as JsonValue,sourceRef:String(context.anubisSourceRef),remaining:rest as unknown as JsonValue,deadlineAt:Number(context.interventionDeadlineAt??0)},cancelled:false});}}
  if(context.engineerStatue===true&&typeof context.engineerStatueRef==="string"){
    const statueRef=context.engineerStatueRef,statue=draft.cards[statueRef],holder=Number(context.engineerHolderSeat) as Seat,source=Number(context.engineerSourceSeat) as Seat,damage=Number(context.engineerDamageAmount);
    if(!Number.isFinite(damage))throw new Error("ENGINEER_STATUE_DAMAGE_INVALID");
    if(statue?.zoneRef===`judgment:${holder}`){const from=draft.zones[`judgment:${holder}`]!,i=from.orderedCardRefs.indexOf(statueRef);if(i>=0)from.orderedCardRefs.splice(i,1);if(matched){draft.zones.discardPile!.orderedCardRefs.push(statueRef);Object.assign(statue,{zoneRef:"discardPile",ownerSeat:null,controllerSeat:null,faceUp:true});draft.scheduledEffects.push({scheduledId:`scheduled:engineer-statue:${statueRef}:${judgmentId}`,sourceRef:statueRef,controllerSeat:source,executeAt:"immediate.damagePipeline",effect:{op:"createDamage",targetRef:`character:${holder}`,amount:damage,damageType:"hp",element:"none",attackType:"effect",deliveryType:"direct",isAdditional:false,sourceAbilityId:"statue.engineer",ignoreArmor:false},cancelled:false});tx.emit("statue.engineer.matched",{cardRef:statueRef,sourceSeat:source,targetSeat:holder,damage});}else{const candidates=([1,2,3,4] as Seat[]).map(d=>(((holder-1+d)%4)+1) as Seat).filter(n=>{const p=draft.players.find(x=>x.seat===n)!;return n!==holder&&p.presence==="inPlay"&&p.lifeState!=="eliminated";}),next=candidates[0];if(next){draft.zones[`judgment:${next}`]!.orderedCardRefs.push(statueRef);Object.assign(statue,{zoneRef:`judgment:${next}`,ownerSeat:next,controllerSeat:next,faceUp:true});tx.emit("statue.engineer.passed",{cardRef:statueRef,fromSeat:holder,toSeat:next,sourceSeat:source});}else{draft.zones.discardPile!.orderedCardRefs.push(statueRef);Object.assign(statue,{zoneRef:"discardPile",ownerSeat:null,controllerSeat:null,faceUp:true});}}tx.emit("card.moved",{cardRef:statueRef,fromZoneRef:`judgment:${holder}`,toZoneRef:statue.zoneRef,moveKind:"systemMove"});}
  }
  if (cardRef) {
    const card = draft.cards[cardRef]!;
    draft.zones.resolving!.orderedCardRefs.splice(
      draft.zones.resolving!.orderedCardRefs.indexOf(cardRef),
      1,
    );
    draft.zones.discardPile!.orderedCardRefs.push(cardRef);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.moved", {
      cardRef,
      fromZoneRef: "resolving",
      toZoneRef: "discardPile",
      moveKind: "judge",
    });
  }
  draft.pendingWindows = draft.pendingWindows.filter(
    (item) =>
      !(
        item.kind === "judgmentIntervention" ||
        item.kind === "judgmentDesignation"
      ) || item.context?.judgmentId !== judgmentId,
  );
  draft.resolutionStack.pop();
}
export function finalizeJudgment(
  state: AuthoritativeGameState,
  overrideColor?: PrintedColor,
): TransactionCommit<AuthoritativeGameState> {
  const frame = state.resolutionStack.at(-1);
  if (!frame || frame.frameType !== "judgment")
    throw new Error("JUDGMENT_FRAME_MISSING");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    draftFrame = draft.resolutionStack.at(-1)!;
  finalizeJudgmentInTransaction(tx, draftFrame.context, overrideColor);
  return commit(tx);
}
