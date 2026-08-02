import type { LoadedRuleset } from "../ruleset/types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

interface Effect {
  op: string;
  params?: Record<string, unknown>;
}
interface Family {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  effects?: Effect[];
}
interface Document {
  effectFamilies: Family[];
}
const MARKER = "bloodAltarIronShield";
function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as Document,
    rule = document.effectFamilies.find(
      (item) => item.familyId === "special.sp11",
    ),
    max = rule?.effects?.find((effect) => effect.op === "changeMaxHp")?.params
      ?.delta,
    hp = rule?.effects?.find((effect) => effect.op === "changeHp")?.params
      ?.delta,
    iron = rule?.effects?.find((effect) => effect.op === "modifyIronShield")
      ?.params?.setMinimum,
    duration = rule?.effects?.find((effect) => effect.op === "createDuration");
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    max !== -2 ||
    hp !== -2 ||
    iron !== 1 ||
    duration?.params?.durationId !== "duration.bloodAltarIronShield"
  )
    throw new Error("BLOOD_ALTAR_RULE_INVALID");
  return {
    maxDelta: Number(max),
    hpDelta: Number(hp),
    ironMinimum: Number(iron),
  };
}
function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (item) => item.kind === "playPhaseAction" && item.prioritySeat === seat,
  );
}
export interface BloodAltarOffer {
  offerId: string;
  cardRef: string;
  stateRevision: number;
}
export function buildBloodAltarOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): BloodAltarOffer[] {
  definition(ruleset);
  const player = state.players.find((item) => item.seat === seat);
  if (
    !player ||
    player.lifeState !== "alive" ||
    player.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !playWindow(state, seat) ||
    state.combat.attack
  )
    return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp11",
  ).map((cardRef) => ({
    offerId: `offer:special.sp11:${cardRef}`,
    cardRef,
    stateRevision: state.stateRevision,
  }));
}
export function expireBloodAltarAtPrepareBefore(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  const player = tx.draft.players.find((item) => item.seat === seat)!,
    marker = player.markers[MARKER];
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return;
  const durationId =
      typeof marker.durationId === "string" ? marker.durationId : null,
    contribution = Number(marker.contribution ?? 0);
  if (!durationId) return;
  delete player.markers[MARKER];
  tx.draft.durations = tx.draft.durations.filter(
    (item) => item.durationId !== durationId,
  );
  if (Number.isInteger(contribution) && contribution > 0) {
    const before = player.ironShield;
    player.ironShield = Math.max(0, before - contribution);
    tx.emit("value.changed", {
      seat,
      path: "ironShield",
      from: before,
      to: player.ironShield,
      reason: "special.sp11.expiry",
    });
  }
  if (player.presence === "inPlay" && player.lifeState !== "eliminated") {
    player.markers.bloodCurseEnabled = true;
    tx.emit("ability.enabled", {
      seat,
      abilityId: "ability.bloodCurse",
      permanent: true,
    });
  }
  tx.emit("duration.expired", {
    durationId,
    point: "owner.nextPhase.prepare.before",
    skipped: false,
  });
}
export interface BloodAltarCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
export type BloodAltarResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      offers: BloodAltarOffer[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };
export class BloodAltarSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, BloodAltarResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  offersFor(userId: string) {
    const seat = this.#state.players.find(
      (item) => item.userId === userId,
    )?.seat;
    return seat ? buildBloodAltarOffers(this.#state, this.ruleset, seat) : [];
  }
  handle(command: BloodAltarCommand): BloodAltarResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): BloodAltarResult => {
      const result = {
        accepted: false as const,
        commandId: command.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(command.commandId, result);
      return structuredClone(result);
    };
    if (command.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find(
        (item) => item.userId === command.actorUserId,
      ),
      window = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildBloodAltarOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (item) =>
        item.offerId === command.offerId && item.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state),
      player = tx.draft.players.find((item) => item.seat === actor.seat)!,
      rule = definition(this.ruleset);
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    const maxBefore = player.maxHp!,
      hpBefore = player.hp!;
    player.maxHp = maxBefore + rule.maxDelta;
    if (player.hp! > player.maxHp) player.hp = player.maxHp;
    const hpAfterClamp = player.hp!;
    player.hp = hpAfterClamp + rule.hpDelta;
    tx.emit("value.changed", {
      seat: actor.seat,
      path: "maxHp",
      from: maxBefore,
      to: player.maxHp,
      semantic: "modifyNotDamage",
      sourceRef: command.cardRef,
    });
    tx.emit("value.changed", {
      seat: actor.seat,
      path: "hp",
      from: hpBefore,
      to: player.hp,
      clampedBeforeDelta: hpAfterClamp,
      semantic: "modifyNotDamage",
      sourceRef: command.cardRef,
    });
    const ironBefore = player.ironShield,
      contribution = Math.max(0, rule.ironMinimum - ironBefore),
      durationId = `duration:blood-altar:${actor.seat}:${tx.draft.stateRevision + 1}`;
    player.ironShield = ironBefore + contribution;
    player.markers[MARKER] = {
      durationId,
      contribution,
      sourceRef: command.cardRef,
    };
    tx.draft.durations.push({
      durationId,
      sourceRef: command.cardRef,
      ownerRef: `character:${actor.seat}`,
      anchorEventId: null,
      activationPoint: "special.sp11.resolved",
      expiryPoint: "owner.nextPhase.prepare.before",
      remainingCount: null,
      countScope: "owner",
      skipPolicy: "expireOnSkippedBoundary",
      sourceLeavePolicy: "continue",
      ownerEliminatedPolicy: "cancel",
      cleanupEffects: [],
    });
    tx.emit("duration.created", {
      durationId,
      seat: actor.seat,
      sourceRef: command.cardRef,
      kind: "bloodAltarIronShield",
      ironShieldContribution: contribution,
      expiryPoint: "owner.nextPhase.prepare.before",
    });
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
    tx.emit("card.resolved", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp11",
    });
    if (player.hp <= 0) {
      tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
        (item) => item.promptId !== window.promptId,
      );
      player.markers["dying.resumePlayDeadlineAt"] = window.deadlineAt;
      player.lifeState = "dying";
      tx.draft.combat.dyingStack.push(`character:${actor.seat}`);
      tx.emit("dying.check", {
        targetRef: `character:${actor.seat}`,
        hp: player.hp,
        reason: "special.sp11",
      });
      tx.emit("dying.enter", {
        targetRef: `character:${actor.seat}`,
        reason: "special.sp11",
      });
    }
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result = {
      accepted: true as const,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
      offers: this.offersFor(command.actorUserId),
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}
