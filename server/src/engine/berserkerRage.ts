import type { LoadedRuleset } from "../ruleset/types.js";
import { addDrawCountModifierInTransaction } from "./drawCount.js";
import { grantGuaranteedCriticalInTransaction } from "./guaranteedCritical.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

interface Rule {
  ruleId: string;
  effects: Array<{ op: string; params?: Record<string, unknown> }>;
}
interface Document {
  rules: Rule[];
}
const RESOLVED = "berserker.rageResolvedForCurrentDraw";
function ruleFor(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as Document,
    rule = document.rules.find(
      (item) => item.ruleId === "character.berserker.rage",
    ),
    options = rule?.effects.find((effect) => effect.op === "selectOption")
      ?.params?.options;
  if (
    !Array.isArray(options) ||
    options.some((value) => !Number.isInteger(value))
  )
    throw new Error("BERSERKER_RAGE_RULE_INVALID");
  return options as number[];
}
function eligible(state: AuthoritativeGameState, seat: Seat) {
  const player = state.players.find((item) => item.seat === seat);
  return (
    player?.characterId === "character.berserker" &&
    player.skillIds.includes("skill.berserker.rage") &&
    player.lifeState !== "eliminated" &&
    player.markers[RESOLVED] !== true
  );
}
export function openBerserkerRageWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  deadlineAt: number,
): boolean {
  if (!eligible(tx.draft, seat)) return false;
  const options = ruleFor(ruleset),
    promptId = `prompt:berserker-rage:${tx.draft.round}:${seat}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "berserkerRage",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: options.map((value) => `offer:berserker-rage:${value}`),
    context: { options },
  });
  tx.emit("choice.requested", {
    kind: "berserkerRage",
    seat,
    promptId,
    options,
  });
  return true;
}
export function clearBerserkerDrawResolution(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  delete tx.draft.players.find((item) => item.seat === seat)!.markers[RESOLVED];
}
export interface BerserkerRageCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
}
export type BerserkerRageResult =
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
export class BerserkerRageSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, BerserkerRageResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: BerserkerRageCommand): BerserkerRageResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): BerserkerRageResult => {
      const out = {
        accepted: false as const,
        commandId: command.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(command.commandId, out);
      return structuredClone(out);
    };
    if (command.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const window = this.#state.pendingWindows.find(
        (item) => item.kind === "berserkerRage",
      ),
      actor = this.#state.players.find(
        (item) => item.userId === command.actorUserId,
      );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const choice = Number(command.offerId.split(":").at(-1));
    if (!ruleFor(this.ruleset).includes(choice))
      return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state),
      player = tx.draft.players.find((item) => item.seat === actor.seat)!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    player.markers[RESOLVED] = true;
    if (choice > 0) {
      addDrawCountModifierInTransaction(tx, {
        seat: actor.seat,
        modifierId: `berserkerRage:${tx.draft.round}:${actor.seat}`,
        sourceRef: `character:${actor.seat}`,
        delta: -choice,
        remainingAffectedDraws: 1,
      });
      grantGuaranteedCriticalInTransaction(tx, {
        ownerSeat: actor.seat,
        sourceRef: `character:${actor.seat}`,
        appliesTo: "weaponAttack",
        consumePolicy: "onFirstCommittedApplicableAttack",
        expiryPoint: "owner.currentTurn.end",
      });
    }
    if (choice === 2) {
      const limitId = this.ruleset.settings.combat.attackCountLimitId,
        before = Number(player.limits[limitId] ?? 0);
      player.limits[limitId] = before + 1;
      tx.emit("limit.changed", {
        seat: actor.seat,
        limitId,
        from: before,
        to: before + 1,
        reason: "skill.berserker.rage",
      });
    }
    tx.emit("choice.resolved", {
      kind: "berserkerRage",
      seat: actor.seat,
      choice,
    });
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
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "berserkerRage",
    )!;
    const actor = this.#state.players.find(
      (item) => item.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: "offer:berserker-rage:0",
    });
  }
}
