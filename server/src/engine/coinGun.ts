import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
type A = Record<string, JsonValue>;
const ownedW54 = (s: AuthoritativeGameState, n: Seat) =>
  Object.values(s.zones)
    .filter(
      (z) =>
        z.ownerSeat === n &&
        ["weaponSlot", "thirdWeaponSlot"].includes(z.zoneType),
    )
    .flatMap((z) => z.orderedCardRefs)
    .find((ref) => s.cards[ref]?.templateId === "weapon.w54");
export function openTemporaryCoinChoiceAfterHit(
  commit: TransactionCommit<AuthoritativeGameState>,
  deadlineAt: number,
) {
  const a = commit.state.combat.attack as A | null;
  if (
    !a ||
    a.weaponId !== "weapon.w66" ||
    a.temporaryCoinOffered === true ||
    a.status !== "targetHit"
  )
    return commit;
  const target = commit.state.combat.currentTargetRef;
  if (typeof target !== "string") return commit;
  const seat = Number(target.split(":")[1]) as Seat,
    tx = new EngineTransaction(commit.state),
    attack = tx.draft.combat.attack as A;
  attack.temporaryCoinOffered = true;
  attack.status = "awaitingTemporaryCoinChoice";
  const w54 = ownedW54(tx.draft, seat),
    offers = [
      "offer:temporary-coin:pass",
      ...(w54 ? ["offer:temporary-coin:w54"] : []),
    ],
    promptId = `prompt:w66:${attack.attackId}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "temporaryCoinImmediateUse",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: offers,
    context: { targetRef: target, w54Ref: w54 ?? null },
  });
  tx.emit("temporaryResource.created", {
    resourceId: `temporary-coin:${attack.attackId}`,
    semantic: "coin",
    controllerSeat: seat,
    entersZone: null,
  });
  tx.emit("choice.requested", {
    promptId,
    kind: "temporaryCoinImmediateUse",
    seat,
    offers,
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return { ...out, events: [...commit.events, ...out.events] };
}
type C = {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRef?: string;
};
type R =
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
export class TemporaryCoinSession {
  #state: AuthoritativeGameState;
  constructor(s: AuthoritativeGameState) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: C): R {
    const bad = (reasonCode: string): R => ({
        accepted: false,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired: true,
      }),
      w = this.#state.pendingWindows.find(
        (x) =>
          x.promptId === c.promptId && x.kind === "temporaryCoinImmediateUse",
      ),
      actor = this.#state.players.find((x) => x.userId === c.actorUserId);
    if (
      c.gameId !== this.#state.gameId ||
      c.expectedStateRevision !== this.#state.stateRevision
    )
      return bad("STALE_REVISION");
    if (
      !w ||
      !actor ||
      actor.seat !== w.prioritySeat ||
      !w.legalOfferIds.includes(c.offerId)
    )
      return bad("OFFER_EXPIRED");
    const tx = new EngineTransaction(this.#state),
      a = tx.draft.combat.attack as A;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    if (c.offerId === "offer:temporary-coin:w54") {
      const ref = String(w.context?.w54Ref),
        target = c.targetRef;
      if (
        !target ||
        !tx.draft.players.some(
          (x) =>
            `character:${x.seat}` === target &&
            x.presence === "inPlay" &&
            x.lifeState !== "eliminated",
        )
      )
        return bad("TARGET_NO_LONGER_LEGAL");
      const queued = Array.isArray(a.afterAttackQueue)
        ? a.afterAttackQueue
        : [];
      queued.push({
        attackId: `attack:w54-temp:${tx.draft.stateRevision + 1}`,
        attackerSeat: actor.seat,
        weaponRef: ref,
        weaponId: "weapon.w54",
        modeId: "coin",
        targetRefs: [target],
        killCardRefs: [],
        costCardRefs: [],
        range: 4,
        attackTypes: ["field"],
        responsePolicy: "fieldDefault",
        damageSegments: [
          {
            segmentId: "base",
            deliveryType: "field",
            attackType: "field",
            damageType: "normal",
            element: "none",
            amount: 3,
            repeat: 1,
            isAdditional: false,
            overflowPolicy: "default",
          },
        ],
        status: "committed",
        tags: ["temporary.coin"],
      } as unknown as JsonValue);
      a.afterAttackQueue = queued;
    }
    a.status = "targetHit";
    tx.emit("temporaryResource.consumed", {
      semantic: "coin",
      controllerSeat: actor.seat,
      selectedUse: c.offerId,
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    return {
      accepted: true,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
  }
}
