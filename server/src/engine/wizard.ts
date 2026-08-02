import type { LoadedRuleset } from "../ruleset/types.js";
import { beginJudgment, type PrintedColor } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { validateAuthoritativeState } from "./stateValidation.js";
const CHARACTER = "character.wizard",
  ABILITY = "skill.wizard.spell_strike";
type Outcome = {
  kind: "damage" | "status" | "none";
  element?: string;
  amount?: number;
  repeat?: number;
  statusId?: string;
};
type Runtime = {
  discardHandCount: number;
  outcomes: Record<PrintedColor, Outcome>;
  ignoreTalentModifiers: boolean;
};
function definition(r: LoadedRuleset): Runtime {
  const d = r.documents.get("character-rules.json") as {
      abilities: Array<{ abilityId: string; runtime?: Runtime }>;
    },
    x = d.abilities.find((a) => a.abilityId === ABILITY)?.runtime;
  if (!x || x.discardHandCount !== 1 || !x.outcomes || !x.ignoreTalentModifiers)
    throw new Error("WIZARD_SPELL_STRIKE_RULE_INVALID");
  return x;
}
const attackOf = (s: AuthoritativeGameState) =>
  s.combat.attack &&
  typeof s.combat.attack === "object" &&
  !Array.isArray(s.combat.attack)
    ? (s.combat.attack as Record<string, JsonValue>)
    : null;
function payload(e: DomainEvent) {
  return e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
    ? e.payload
    : {};
}
function openWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  r: LoadedRuleset,
  data: Record<string, JsonValue>,
  deadlineAt: number,
) {
  const seat = Number(data.attackerSeat) as Seat,
    refs = [...tx.draft.zones[`hand:${seat}`]!.orderedCardRefs],
    attack = attackOf(tx.draft);
  if (!attack || !refs.length) return false;
  delete attack.pendingWizardSpellStrike;
  const promptId = `prompt:wizard-spell-strike:${String(data.attackId)}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "wizardSpellStrike",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      "offer:wizard-spell-strike:pass",
      "offer:wizard-spell-strike:activate",
    ],
    context: {
      attackId: String(data.attackId),
      targetRef: String(data.targetRef),
      legalCardRefs: refs,
    },
  });
  tx.emit("choice.requested", {
    kind: "wizardSpellStrike",
    promptId,
    seat,
    attackId: String(data.attackId),
    targetRef: String(data.targetRef),
    legalCardRefs: refs,
  });
  return true;
}
function eligible(s: AuthoritativeGameState, data: Record<string, JsonValue>) {
  const seat = Number(data.attackerSeat) as Seat,
    p = s.players.find((x) => x.seat === seat),
    a = attackOf(s);
  return Boolean(
    p?.characterId === CHARACTER &&
      p.skillIds.includes(ABILITY) &&
      a &&
      Array.isArray(a.killCardRefs) &&
      a.killCardRefs.length > 0 &&
      a.wizardSpellStrikeOffered !== true,
  );
}
export function processWizardSpellStrikeHitEvents(
  c: TransactionCommit<AuthoritativeGameState>,
  r: LoadedRuleset,
  deadlineAt: number,
) {
  let state = c.state;
  const extra: DomainEvent[] = [];
  for (const e of c.events) {
    if (e.eventType !== "attack.hit") continue;
    const raw = payload(e),
      currentAttack = attackOf(state);
    const data = {
      ...raw,
      attackerSeat: currentAttack?.attackerSeat ?? raw.attackerSeat ?? null,
    };
    if (!eligible(state, data)) continue;
    const tx = new EngineTransaction(state),
      a = attackOf(tx.draft)!;
    a.wizardSpellStrikeOffered = true;
    if (tx.draft.pendingWindows.length) a.pendingWizardSpellStrike = data;
    else openWindow(tx, r, data, deadlineAt);
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    state = out.state;
    extra.push(...out.events);
    break;
  }
  return {
    previousRevision: c.previousRevision,
    state,
    events: [...c.events, ...extra],
  };
}
export function openPendingWizardSpellStrike(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> | null {
  const a = attackOf(s);
  let data = a?.pendingWizardSpellStrike;
  if (
    (!data || typeof data !== "object" || Array.isArray(data)) &&
    a?.status === "targetHit" &&
    a.currentTargetHit === true
  ) {
    const inferred = {
      attackId: String(a.attackId),
      targetRef: String(s.combat.currentTargetRef),
      attackerSeat: a.attackerSeat ?? null,
    };
    if (eligible(s, inferred)) data = inferred;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const tx = new EngineTransaction(s);
  attackOf(tx.draft)!.wizardSpellStrikeOffered = true;
  if (!openWindow(tx, r, data as Record<string, JsonValue>, deadlineAt)) {
    delete attackOf(tx.draft)!.pendingWizardSpellStrike;
    const empty = tx.commit();
    empty.state.history.domainEvents.push(...empty.events);
    return empty;
  }
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}
function effects(r: LoadedRuleset, targetRef: string) {
  const d = definition(r);
  return Object.fromEntries(
    Object.entries(d.outcomes).map(([color, o]) => {
      if (o.kind === "damage")
        return [
          color,
          [
            {
              op: "createDamage",
              params: {
                requiresAttackHit: true,
                segment: {
                  segmentId: `wizardSpellStrike.${color}`,
                  deliveryType: "attack",
                  attackType: "effect",
                  damageType: "normal",
                  element: o.element,
                  amount: o.amount,
                  repeat: o.repeat,
                  isAdditional: true,
                  overflowPolicy: "normal",
                  ignoreTalentModifiers: true,
                },
              },
            },
          ],
        ];
      if (o.kind === "status")
        return [
          color,
          [{ op: "applyStatus", params: { statusId: o.statusId } }],
        ];
      return [color, []];
    }),
  ) as Record<string, JsonValue>;
}
export interface WizardSpellStrikeCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef?: string;
}
type Result =
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
export class WizardSpellStrikeSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(
    state: AuthoritativeGameState,
    private r: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(c: WizardSpellStrikeCommand): Result {
    const old = this.#results.get(c.commandId);
    if (old) return structuredClone(old);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => {
      const x = {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(c.commandId, x);
      return structuredClone(x);
    };
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const w = this.#state.pendingWindows.find(
        (x) => x.kind === "wizardSpellStrike" && x.promptId === c.promptId,
      ),
      actor = this.#state.players.find((p) => p.userId === c.actorUserId);
    if (!w) return reject("PROMPT_CLOSED", true);
    if (!actor || actor.seat !== w.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!w.legalOfferIds.includes(c.offerId))
      return reject("OFFER_EXPIRED", true);
    const activate = c.offerId.endsWith(":activate"),
      legal = Array.isArray(w.context?.legalCardRefs)
        ? w.context.legalCardRefs
        : [];
    if (
      activate &&
      (!c.cardRef ||
        !legal.includes(c.cardRef) ||
        this.#state.cards[c.cardRef]?.zoneRef !== `hand:${actor.seat}`)
    )
      return reject("COST_SELECTION_INVALID", false);
    if (!activate && c.cardRef) return reject("COST_SELECTION_INVALID", false);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    if (!activate) {
      tx.emit("trigger.passed", {
        seat: actor.seat,
        abilityId: ABILITY,
        attackId: String(w.context?.attackId),
      });
      const out = tx.commit();
      out.state.history.domainEvents.push(...out.events);
      validateAuthoritativeState(out.state);
      this.#state = out.state;
      const result = {
        accepted: true as const,
        commandId: c.commandId,
        previousRevision: out.previousRevision,
        stateRevision: out.state.stateRevision,
        events: out.events,
      };
      this.#results.set(c.commandId, result);
      return structuredClone(result);
    }
    moveCardInTransaction(tx, {
      cardRef: c.cardRef!,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: ABILITY,
      cardRef: c.cardRef!,
      attackId: String(w.context?.attackId),
      targetRef: String(w.context?.targetRef),
    });
    const paid = tx.commit();
    paid.state.history.domainEvents.push(...paid.events);
    const input = {
        controllerSeat: actor.seat,
        sourceRef: `character:${actor.seat}`,
        purpose: "wizardSpellStrike",
        matchColors: ["red", "orange", "blue", "green"] as PrintedColor[],
        context: {
          attackId: String(w.context?.attackId),
          targetRef: String(w.context?.targetRef),
          judgmentRuleId: "wizardSpellStrike",
          resumeAttackStatus: "targetHit",
          effectsByColor: effects(this.r, String(w.context?.targetRef)),
        },
      },
      begun =
        openPreJudgmentWindow(paid.state, this.r, input, w.deadlineAt) ??
        beginJudgment(paid.state, this.r, input, w.deadlineAt);
    this.#state = begun.state;
    const result = {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: paid.previousRevision,
      stateRevision: begun.state.stateRevision,
      events: [...paid.events, ...begun.events],
    };
    this.#results.set(c.commandId, result);
    return structuredClone(result);
  }
}
