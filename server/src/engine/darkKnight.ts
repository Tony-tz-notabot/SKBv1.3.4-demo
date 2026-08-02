import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateEffectiveDistance } from "./distance.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";

type Mode = "thrust" | "slash" | "hammer";
interface DarkKnightModeRule {
  modeId: Mode;
  costMarker: number;
  range: number;
  attackType: "ranged" | "melee" | "field";
  tags: string[];
  damage: { amount: number; repeat: number };
  dodge: boolean;
  onHit?: Array<{ op: string; params?: { statusId?: string } }>;
}
interface DarkKnightRule {
  familyId: string;
  blackSword: { max: number; createAction: { maxUsesPerPhase: number } };
  attackModes: DarkKnightModeRule[];
}
interface BossRuleDocument {
  effectFamilies: DarkKnightRule[];
}
const SWORDS = "darkKnight.blackSword";
function ruleFor(ruleset: LoadedRuleset): DarkKnightRule {
  const document = ruleset.documents.get("boss-rules.json") as BossRuleDocument,
    rule = document.effectFamilies.find(
      (item) => item.familyId === "boss.dark_grand_knight",
    );
  if (!rule) throw new Error("DARK_KNIGHT_RULE_MISSING");
  return rule;
}
const createKey = (state: AuthoritativeGameState) =>
  `darkKnight.blackSwordCreates.${state.round}:${state.activeSeat}:${state.phase}`;

function activeBoss(state: AuthoritativeGameState, seat: Seat) {
  const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0],
    card = ref ? state.cards[ref] : undefined;
  return card?.templateId === "boss.dark_grand_knight" &&
    card.runtime.active === true
    ? card
    : undefined;
}

function assertPlay(state: AuthoritativeGameState, seat: Seat) {
  const player = state.players.find((item) => item.seat === seat);
  if (
    !player ||
    player.lifeState === "eliminated" ||
    player.presence !== "inPlay"
  )
    throw new Error("DARK_KNIGHT_ACTOR_INVALID");
  if (
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body"
  )
    throw new Error("DARK_KNIGHT_PLAY_WINDOW_REQUIRED");
  const boss = activeBoss(state, seat);
  if (!boss) throw new Error("DARK_KNIGHT_NOT_ACTIVE");
  return { player, boss };
}

function finish(tx: EngineTransaction<AuthoritativeGameState>) {
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}

export function createDarkKnightBlackSword(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  actorSeat: Seat,
) {
  const { player, boss } = assertPlay(state, actorSeat),
    rule = ruleFor(ruleset),
    swords = Number(player.markers[SWORDS] ?? 0),
    key = createKey(state),
    used = Number(player.markers[key] ?? 0);
  if (swords >= rule.blackSword.max)
    throw new Error("DARK_KNIGHT_BLACK_SWORD_FULL");
  if (used >= rule.blackSword.createAction.maxUsesPerPhase)
    throw new Error("DARK_KNIGHT_CREATE_LIMIT_REACHED");
  if (player.hp === null || player.maxHp === null)
    throw new Error("DARK_KNIGHT_HP_UNAVAILABLE");
  const tx = new EngineTransaction(state),
    draftPlayer = tx.draft.players.find((item) => item.seat === actorSeat)!;
  const hpBefore = draftPlayer.hp!,
    maxBefore = draftPlayer.maxHp!;
  draftPlayer.hp = hpBefore - 1;
  draftPlayer.maxHp = Math.max(0, maxBefore - 1);
  if (draftPlayer.hp > draftPlayer.maxHp) draftPlayer.hp = draftPlayer.maxHp;
  draftPlayer.markers[key] = used + 1;
  draftPlayer.markers[SWORDS] = swords + 1;
  tx.emit("stat.changed", {
    seat: actorSeat,
    stat: "hp",
    from: hpBefore,
    to: draftPlayer.hp,
    semantic: "modifyNotDamage",
    sourceRef: boss.cardRef,
  });
  tx.emit("stat.changed", {
    seat: actorSeat,
    stat: "maxHp",
    from: maxBefore,
    to: draftPlayer.maxHp,
    semantic: "modifyNotDamage",
    sourceRef: boss.cardRef,
  });
  tx.emit("counter.changed", {
    seat: actorSeat,
    counterId: SWORDS,
    from: swords,
    to: swords + 1,
    reason: "darkKnightCreateBlackSword",
  });
  if (draftPlayer.hp <= 0 && draftPlayer.lifeState === "alive") {
    const play = tx.draft.pendingWindows.find(
      (window) =>
        window.kind === "playPhaseAction" && window.prioritySeat === actorSeat,
    );
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (window) => window.promptId !== play?.promptId,
    );
    draftPlayer.markers["dying.resumePlayDeadlineAt"] = play?.deadlineAt ?? 0;
    draftPlayer.lifeState = "dying";
    const ref = `character:${actorSeat}`;
    tx.draft.combat.dyingStack.push(ref);
    tx.emit("dying.enter", {
      targetRef: ref,
      seat: actorSeat,
      reason: "darkKnightCreateBlackSword",
    });
  }
  return finish(tx);
}

export interface DarkKnightActionOffer {
  offerId: string;
  kind: "createBlackSword" | "blackSwordAttack";
  mode?: Mode;
  legalTargetSeats: Seat[];
  stateRevision: number;
}

export function buildDarkKnightActionOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  actorSeat: Seat,
): DarkKnightActionOffer[] {
  let context: ReturnType<typeof assertPlay>;
  try {
    context = assertPlay(state, actorSeat);
  } catch {
    return [];
  }
  if (state.combat.attack || state.combat.dyingStack.length) return [];
  const swords = Number(context.player.markers[SWORDS] ?? 0),
    used = Number(context.player.markers[createKey(state)] ?? 0),
    rule = ruleFor(ruleset),
    offers: DarkKnightActionOffer[] = [];
  if (
    swords < rule.blackSword.max &&
    used < rule.blackSword.createAction.maxUsesPerPhase &&
    context.player.hp !== null &&
    context.player.maxHp !== null
  )
    offers.push({
      offerId: "offer:dark-knight:create-black-sword",
      kind: "createBlackSword",
      legalTargetSeats: [],
      stateRevision: state.stateRevision,
    });
  if (swords > 0)
    for (const mode of rule.attackModes) {
      const modeId = mode.modeId;
      const legalTargetSeats = state.players
        .filter(
          (target) =>
            target.lifeState !== "eliminated" &&
            target.presence === "inPlay" &&
            calculateEffectiveDistance(state, actorSeat, target.seat) <=
              mode.range,
        )
        .map((target) => target.seat);
      if (legalTargetSeats.length)
        offers.push({
          offerId: `offer:dark-knight:attack:${modeId}`,
          kind: "blackSwordAttack",
          mode: modeId,
          legalTargetSeats,
          stateRevision: state.stateRevision,
        });
    }
  return offers;
}

export function commitDarkKnightBlackSwordAttack(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: { actorSeat: Seat; targetSeat: Seat; mode: Mode },
) {
  const { player, boss } = assertPlay(state, input.actorSeat),
    mode = ruleFor(ruleset).attackModes.find(
      (item) => item.modeId === input.mode,
    ),
    target = state.players.find((item) => item.seat === input.targetSeat),
    swords = Number(player.markers[SWORDS] ?? 0);
  if (!mode) throw new Error("DARK_KNIGHT_MODE_INVALID");
  if (swords < mode.costMarker)
    throw new Error("DARK_KNIGHT_BLACK_SWORD_UNAVAILABLE");
  if (
    !target ||
    target.lifeState === "eliminated" ||
    target.presence !== "inPlay" ||
    calculateEffectiveDistance(state, input.actorSeat, input.targetSeat) >
      mode.range
  )
    throw new Error("DARK_KNIGHT_TARGET_INVALID");
  const play = state.pendingWindows.find(
      (window) =>
        window.kind === "playPhaseAction" &&
        window.prioritySeat === input.actorSeat,
    ),
    tx = new EngineTransaction(state),
    draftPlayer = tx.draft.players.find(
      (item) => item.seat === input.actorSeat,
    )!;
  tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
    (window) => window.promptId !== play?.promptId,
  );
  draftPlayer.markers[SWORDS] = swords - mode.costMarker;
  createScriptedAttackInTransaction(tx, {
    attackId: `attack:dark-knight:${input.mode}:${tx.draft.stateRevision + 1}:${input.actorSeat}`,
    attackerSeat: input.actorSeat,
    targetRef: `character:${input.targetSeat}`,
    sourceRef: boss.cardRef,
    weaponId: "boss.dark_grand_knight",
    modeId: input.mode,
    range: mode.range,
    attackTypes: [
      mode.attackType,
      ...(mode.tags.includes("scatter") ? ["scatter"] : []),
    ],
    damageSegments: [
      {
        segmentId: input.mode,
        deliveryType: "attack",
        attackType: mode.attackType,
        damageType: "normal",
        element: "none",
        amount: mode.damage.amount,
        repeat: mode.damage.repeat,
        isAdditional: false,
        overflowPolicy: "normal",
      },
    ],
    ignoreArmor: mode.tags.includes("ignoreArmor"),
    cannotMeleeBlock: mode.tags.includes("cannotMeleeBlock"),
    tags: ["bossAttack", "darkKnightBlackSword", ...mode.tags],
  });
  const attack = tx.draft.combat.attack as Record<string, JsonValue>;
  attack.resumePlayDeadlineAt = play?.deadlineAt ?? 0;
  const statuses =
    mode.onHit
      ?.filter((effect) => effect.op === "applyStatus")
      .map((effect) => effect.params?.statusId)
      .filter((id): id is string => typeof id === "string") ?? [];
  if (statuses.length) attack.onHitStatuses = statuses;
  tx.emit("counter.changed", {
    seat: input.actorSeat,
    counterId: SWORDS,
    from: swords,
    to: swords - mode.costMarker,
    reason: `darkKnightAttack.${input.mode}`,
  });
  return finish(tx);
}

export interface DarkKnightActionCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetSeat?: Seat;
}
export type DarkKnightActionResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      offers: DarkKnightActionOffer[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };

export class DarkKnightActionSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DarkKnightActionResult>();
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
      (player) => player.userId === userId,
    )?.seat;
    return seat
      ? buildDarkKnightActionOffers(this.#state, this.ruleset, seat)
      : [];
  }
  handle(command: DarkKnightActionCommand): DarkKnightActionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): DarkKnightActionResult => {
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
        (player) => player.userId === command.actorUserId,
      ),
      window = actor
        ? this.#state.pendingWindows.find(
            (item) =>
              item.kind === "playPhaseAction" &&
              item.prioritySeat === actor.seat,
          )
        : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildDarkKnightActionOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find((item) => item.offerId === command.offerId);
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (offer.kind === "createBlackSword" && command.targetSeat !== undefined)
      return reject("TARGET_INVALID", false);
    if (
      offer.kind === "blackSwordAttack" &&
      (command.targetSeat === undefined ||
        !offer.legalTargetSeats.includes(command.targetSeat))
    )
      return reject("TARGET_NO_LONGER_LEGAL", true);
    const committed =
      offer.kind === "createBlackSword"
        ? createDarkKnightBlackSword(this.#state, this.ruleset, actor.seat)
        : commitDarkKnightBlackSwordAttack(this.#state, this.ruleset, {
            actorSeat: actor.seat,
            targetSeat: command.targetSeat!,
            mode: offer.mode!,
          });
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
