import type { LoadedRuleset } from "../ruleset/types.js";
import { finalizeCurrentAttack } from "./attackLifecycle.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";

interface OwlTriggerData {
  sourceAttackId: string;
  owlSeat: Seat;
  attackerSeat: Seat;
  targetRef: string;
  actualDamage: number;
}
function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects?: Array<{ op?: string; params?: Record<string, unknown> }>;
      }>;
    },
    rule = document.rules.find(
      (candidate) => candidate.ruleId === "character.headtaker.owl",
    ),
    params = rule?.effects?.find(
      (effect) => effect.op === "createAttack",
    )?.params;
  if (
    params?.when !== "$actualDamageFromSource>0" ||
    params.optional !== true ||
    (params.limit as Record<string, unknown> | undefined)?.scope !==
      "perRoundOwner" ||
    (params.limit as Record<string, unknown> | undefined)?.count !== 1 ||
    params.range !== "unlimited" ||
    params.type !== "ranged" ||
    params.damage !== 2
  )
    throw new Error("OWL_RULE_INVALID");
  return { damage: 2 } as const;
}
const payload = (event: DomainEvent) =>
  event.payload &&
  typeof event.payload === "object" &&
  !Array.isArray(event.payload)
    ? (event.payload as Record<string, JsonValue>)
    : {};
function eligible(
  state: AuthoritativeGameState,
  data: OwlTriggerData,
  allowDyingOwl = false,
) {
  const owl = state.players.find((player) => player.seat === data.owlSeat),
    source = state.players.find((player) => player.seat === data.attackerSeat);
  return Boolean(
    owl?.characterId === "character.headtaker" &&
    owl.initialTalentIds.includes("talent.owl") &&
    (owl.lifeState === "alive" ||
      (allowDyingOwl && owl.lifeState === "dying")) &&
    owl.presence === "inPlay" &&
    source &&
    source.lifeState !== "eliminated" &&
    source.presence === "inPlay" &&
    owl.markers.owlUsedRound !== state.round &&
    data.actualDamage > 0 &&
    data.attackerSeat !== data.owlSeat,
  );
}
function openWindowInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  data: OwlTriggerData,
  deadlineAt: number,
) {
  if (!eligible(tx.draft, data)) return false;
  const play = tx.draft.pendingWindows.find(
    (window) => window.kind === "playPhaseAction",
  );
  if (play)
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (window) => window.promptId !== play.promptId,
    );
  const promptId = `prompt:owl:${data.sourceAttackId}:${data.owlSeat}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "owlCounterattack",
    prioritySeat: data.owlSeat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:owl:pass:${data.sourceAttackId}`,
      `offer:owl:attack:${data.sourceAttackId}`,
    ],
    context: {
      ...data,
      resumePlaySeat: play?.prioritySeat ?? null,
      resumePlayDeadlineAt: play?.deadlineAt ?? null,
    },
  });
  tx.emit("choice.requested", {
    kind: "owlCounterattack",
    promptId,
    seat: data.owlSeat,
    sourceAttackId: data.sourceAttackId,
    targetRef: `character:${data.attackerSeat}`,
  });
  return true;
}
export function processOwlTargetAfterEvents(
  committed: TransactionCommit<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> {
  definition(ruleset);
  let state = committed.state;
  const extra: DomainEvent[] = [];
  for (const event of committed.events) {
    if (event.eventType !== "attack.target.after") continue;
    const data = payload(event),
      targetRef = String(data.targetRef),
      owlSeat = Number(targetRef.split(":")[1]) as Seat,
      trigger: OwlTriggerData = {
        sourceAttackId: String(data.attackId),
        owlSeat,
        attackerSeat: Number(data.attackerSeat) as Seat,
        targetRef,
        actualDamage: Number(data.actualDamage ?? 0),
      };
    // The trigger is created after the complete target damage summary, before
    // dying rescue. A dying Headtaker must retain the trigger until that
    // mandatory flow either rescues or eliminates them.
    if (!eligible(state, trigger, true)) continue;
    const tx = new EngineTransaction(state);
    if (
      state.combat.dyingStack.includes(targetRef) &&
      tx.draft.combat.attack &&
      typeof tx.draft.combat.attack === "object" &&
      !Array.isArray(tx.draft.combat.attack)
    ) {
      (tx.draft.combat.attack as Record<string, JsonValue>).pendingOwlTrigger =
        trigger as unknown as JsonValue;
      tx.emit("ability.trigger.deferred", {
        abilityId: "talent.owl",
        seat: owlSeat,
        sourceAttackId: trigger.sourceAttackId,
        reason: "dyingFirst",
      });
    } else openWindowInTransaction(tx, trigger, deadlineAt);
    const next = tx.commit();
    next.state.history.domainEvents.push(...next.events);
    validateAuthoritativeState(next.state);
    state = next.state;
    extra.push(...next.events);
    break;
  }
  return {
    previousRevision: committed.previousRevision,
    state,
    events: [...committed.events, ...extra],
  };
}
export function openPendingOwlWindow(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> | null {
  definition(ruleset);
  const attack = state.combat.attack;
  if (
    !attack ||
    typeof attack !== "object" ||
    Array.isArray(attack) ||
    attack.status !== "awaitingOwlTrigger" ||
    !attack.pendingOwlTrigger ||
    typeof attack.pendingOwlTrigger !== "object" ||
    Array.isArray(attack.pendingOwlTrigger)
  )
    return null;
  const tx = new EngineTransaction(state),
    draftAttack = tx.draft.combat.attack as Record<string, JsonValue>,
    data = draftAttack.pendingOwlTrigger as unknown as OwlTriggerData;
  delete draftAttack.pendingOwlTrigger;
  if (!openWindowInTransaction(tx, data, deadlineAt)) {
    draftAttack.status = tx.draft.combat.targetQueue.length
      ? "committed"
      : "targetMiss";
    if (!tx.draft.combat.targetQueue.length)
      finalizeCurrentAttack(tx, draftAttack, () => deadlineAt);
  } else draftAttack.status = "owlDecision";
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export interface OwlCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
}
export type OwlResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };
export class OwlSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, OwlResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: OwlCommand): OwlResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: OwlResult = {
        accepted: false,
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
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "owlCounterattack",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (player) => player.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const context = window.context as Record<string, JsonValue>,
      data: OwlTriggerData = {
        sourceAttackId: String(context.sourceAttackId),
        owlSeat: Number(context.owlSeat) as Seat,
        attackerSeat: Number(context.attackerSeat) as Seat,
        targetRef: String(context.targetRef),
        actualDamage: Number(context.actualDamage),
      },
      tx = new EngineTransaction(this.#state),
      draftWindow = tx.draft.pendingWindows.find(
        (candidate) => candidate.promptId === window.promptId,
      )!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    const draftOwl = tx.draft.players.find(
      (player) => player.seat === actor.seat,
    )!;
    if (command.offerId.startsWith("offer:owl:attack:")) {
      if (!eligible(tx.draft, data))
        return reject("TRIGGER_NO_LONGER_LEGAL", true);
      draftOwl.markers.owlUsedRound = tx.draft.round;
      const live =
        tx.draft.combat.attack &&
        typeof tx.draft.combat.attack === "object" &&
        !Array.isArray(tx.draft.combat.attack)
          ? (tx.draft.combat.attack as Record<string, JsonValue>)
          : null;
      if (live) {
        delete live.pendingOwlTrigger;
        if (tx.draft.combat.targetQueue.length) {
          live.status = "committed";
          live.targetRefs = [...tx.draft.combat.targetQueue];
        } else if (live.status === "owlDecision") live.status = "targetMiss";
      }
      const continuation =
        tx.draft.combat.attack &&
        typeof tx.draft.combat.attack === "object" &&
        !Array.isArray(tx.draft.combat.attack)
          ? structuredClone(tx.draft.combat.attack as Record<string, JsonValue>)
          : null;
      tx.draft.combat.attack = null;
      tx.draft.combat.targetQueue = [];
      tx.draft.combat.currentTargetRef = null;
      createScriptedAttackInTransaction(tx, {
        attackId: `attack:owl:${actor.seat}:${tx.draft.stateRevision + 1}`,
        attackerSeat: actor.seat,
        targetRef: `character:${data.attackerSeat}`,
        sourceRef: `character:${actor.seat}`,
        weaponId: "talent.owl",
        modeId: "blowDart",
        range: "unlimited",
        attackTypes: ["ranged"],
        damageSegments: [
          {
            segmentId: "talent.owl.blowDart",
            deliveryType: "attack",
            attackType: "ranged",
            damageType: "normal",
            element: "none",
            amount: definition(this.ruleset).damage,
            repeat: 1,
            isAdditional: false,
            overflowPolicy: "normal",
          } as unknown as JsonValue,
        ],
        ...(typeof context.resumePlayDeadlineAt === "number"
          ? { resumePlayDeadlineAt: Number(context.resumePlayDeadlineAt) }
          : {}),
        tags: ["characterTalentAttack", "owlCounterattack"],
      });
      if (continuation) {
        const owlAttack = tx.draft.combat.attack;
        if (
          !owlAttack ||
          typeof owlAttack !== "object" ||
          Array.isArray(owlAttack)
        )
          throw new Error("OWL_ATTACK_CONTEXT_MISSING");
        (owlAttack as Record<string, JsonValue>).continuationQueue = [
          continuation,
        ] as unknown as JsonValue;
      }
      tx.emit("ability.activation.committed", {
        seat: actor.seat,
        abilityId: "talent.owl",
        sourceAttackId: data.sourceAttackId,
        targetRef: `character:${data.attackerSeat}`,
        limitScope: "perRoundOwner",
      });
    } else {
      const attack = tx.draft.combat.attack;
      if (
        attack &&
        typeof attack === "object" &&
        !Array.isArray(attack) &&
        attack.status === "owlDecision"
      ) {
        if (tx.draft.combat.targetQueue.length) attack.status = "committed";
        else finalizeCurrentAttack(tx, attack as Record<string, JsonValue>);
      }
      if (
        typeof draftWindow.context?.resumePlaySeat === "number" &&
        typeof draftWindow.context?.resumePlayDeadlineAt === "number"
      )
        tx.draft.pendingWindows.push({
          promptId: `prompt:playPhaseAction:${tx.draft.round}:${Number(draftWindow.context.resumePlaySeat)}:${tx.draft.stateRevision + 1}`,
          kind: "playPhaseAction",
          prioritySeat: Number(draftWindow.context.resumePlaySeat) as Seat,
          mandatory: false,
          deadlineAt: Number(draftWindow.context.resumePlayDeadlineAt),
          timeoutPolicy: "pass",
          legalOfferIds: ["offer:playPhaseAction:finish"],
          context: {},
        });
      tx.emit("ability.passed", {
        seat: actor.seat,
        abilityId: "talent.owl",
        sourceAttackId: data.sourceAttackId,
      });
    }
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: OwlResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "owlCounterattack",
    );
    if (!window)
      return {
        accepted: false as const,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const actor = this.#state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((offer) => offer.includes(":pass:"))!,
    });
  }
}
