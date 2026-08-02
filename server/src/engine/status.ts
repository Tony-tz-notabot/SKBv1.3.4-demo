import type { LoadedRuleset } from "../ruleset/types.js";
import type {
  AuthoritativeGameState,
  Phase,
  Seat,
  StatusInstanceState,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";
import { setEquippedTalentContributionsEnabled } from "./talentContributions.js";

interface CoreStatusDefinition {
  stackPolicy: StatusInstanceState["stackPolicy"];
  effect: string;
  expiryPoint: string;
  skipPolicy: string;
}
interface CoreRulesDocument {
  statusDefinitions: Record<string, CoreStatusDefinition>;
}
export interface ApplyStatusInput {
  ownerSeat: Seat;
  statusId: string;
  sourceRef?: string | null;
  stacks?: number;
  priority?: number;
  metadata?: Record<string, JsonValue>;
}
const skipPhases = (effect: string): Phase[] => [
  ...(effect.includes("skip prepare") ? ["prepare" as const] : []),
  ...(effect.includes("skip judgment") ? ["judgment" as const] : []),
  ...(effect.includes("skip draw") ? ["draw" as const] : []),
  ...(effect.includes("skip play") ? ["play" as const] : []),
  ...(effect.includes("skip discard") ? ["discard" as const] : []),
];
const ownerRef = (seat: Seat) => `character:${seat}`;
const equipmentEnabled = (state: AuthoritativeGameState, seat: Seat) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return player.markers.equipmentEffectsDisabled !== true && !player.statuses.some((status) => status.statusId === "status.equipmentDisabled");
};
const hasEffectiveTalent = (state: AuthoritativeGameState, seat: Seat, talentId: string) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return player.initialTalentIds.includes(talentId) || (equipmentEnabled(state, seat) && (state.zones[`talent:${seat}`]?.orderedCardRefs ?? []).some((ref) => state.cards[ref]?.templateId === talentId));
};
function sourceSeatForStatus(state: AuthoritativeGameState, input: ApplyStatusInput): Seat | null {
  const direct = /^character:([1-4])$/.exec(input.sourceRef ?? "");
  if (direct) return Number(direct[1]) as Seat;
  const attack = state.combat.attack;
  if (!attack || typeof attack !== "object" || Array.isArray(attack)) return null;
  return input.metadata?.attackId === attack.attackId ? (Number(attack.attackerSeat) as Seat) : null;
}
function removeStatusAndDuration(
  draft: AuthoritativeGameState,
  status: StatusInstanceState,
): void {
  const player = draft.players.find((item) => item.seat === status.ownerSeat)!;
  player.statuses = player.statuses.filter(
    (item) => item.statusRef !== status.statusRef,
  );
  if (status.durationId)
    draft.durations = draft.durations.filter(
      (item) => item.durationId !== status.durationId,
    );
}
export function applyStatusInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: ApplyStatusInput,
): void {
  const document = ruleset.documents.get(
      "core-rules.json",
    ) as CoreRulesDocument,
    definition = document.statusDefinitions[input.statusId] ?? (input.statusId==="status.anubisCurse"?(()=>{const weapons=ruleset.documents.get("weapon-rules.json") as {templates:Array<{weaponId:string;curseDefinition?:{statusId:string;stackPolicy:StatusInstanceState["stackPolicy"];expiryPoint:string}}>};const curse=weapons.templates.find(x=>x.weaponId==="weapon.w56")?.curseDefinition;if(!curse||curse.statusId!==input.statusId)return undefined;return{stackPolicy:curse.stackPolicy,effect:"replace equipped weapons with temporary pistol",expiryPoint:curse.expiryPoint,skipPolicy:"expireOnSkippedBoundary"};})():undefined);
  if (!definition) throw new Error("STATUS_DEFINITION_MISSING");
  const draft = tx.draft,
    player = draft.players.find((item) => item.seat === input.ownerSeat);
  if (!player || player.lifeState === "eliminated")
    throw new Error("STATUS_TARGET_INVALID");
  const stacks = input.stacks ?? 1;
  if (!Number.isInteger(stacks) || stacks < 1)
    throw new Error("STATUS_STACKS_INVALID");
  const draftPlayer = player,
    equipmentWasEnabled = equipmentEnabled(draft, input.ownerSeat),
    existing = draftPlayer.statuses.find(
      (item) => item.statusId === input.statusId,
    ),
    statusRef = `status:${input.statusId}:${input.ownerSeat}:${draft.stateRevision + 1}:${draftPlayer.statuses.length}`,
    durationId =
      definition.expiryPoint === "sourceDefined"
        ? null
        : `duration:${statusRef}`;
  const immune =
    (input.statusId === "status.frozen" &&
      (hasEffectiveTalent(draft, input.ownerSeat, "talent.ice_shield") ||
        hasEffectiveTalent(draft, input.ownerSeat, "talent.element_origin"))) ||
    (input.statusId === "status.electrified" &&
      hasEffectiveTalent(draft, input.ownerSeat, "talent.electric_shield"));
  if (immune) {
    tx.emit("status.prevented", { ownerSeat: input.ownerSeat, statusId: input.statusId, reason: "talentImmunity" });
    return;
  }
  if (existing && definition.stackPolicy === "uniqueIgnore") {
    tx.emit("status.prevented", {
      ownerSeat: input.ownerSeat,
      statusId: input.statusId,
      reason: "uniqueIgnore",
    });
  } else if (existing && definition.stackPolicy === "stackCount") {
    existing.stacks += stacks;
    tx.emit("status.stacked", {
      ownerSeat: input.ownerSeat,
      statusId: input.statusId,
      stacks: existing.stacks,
    });
  } else if (
    existing &&
    definition.stackPolicy === "replaceByPriority" &&
    (input.priority ?? 0) <= existing.priority
  ) {
    tx.emit("status.prevented", {
      ownerSeat: input.ownerSeat,
      statusId: input.statusId,
      reason: "lowerPriority",
    });
  } else {
    if (existing && definition.stackPolicy !== "stackInstances")
      removeStatusAndDuration(draft, existing);
    const status: StatusInstanceState = {
      statusRef,
      statusId: input.statusId,
      ownerSeat: input.ownerSeat,
      sourceRef: input.sourceRef ?? null,
      stackPolicy: definition.stackPolicy,
      stacks,
      priority: input.priority ?? 0,
      durationId,
      skipPhases: skipPhases(definition.effect),
      metadata: structuredClone(input.metadata ?? {}),
    };
    draftPlayer.statuses.push(status);
    if (durationId)
      draft.durations.push({
        durationId,
        sourceRef: status.sourceRef,
        ownerRef: ownerRef(input.ownerSeat),
        anchorEventId: null,
        activationPoint: "status.applied",
        expiryPoint: definition.expiryPoint,
        remainingCount: null,
        countScope: "owner",
        skipPolicy: definition.skipPolicy,
        sourceLeavePolicy: "retain",
        ownerEliminatedPolicy: "cancel",
        cleanupEffects: [],
      });
    const sourceSeat = sourceSeatForStatus(draft, input), result = existing ? "refreshed" : "applied";
    tx.emit(existing ? "status.refreshed" : "status.applied", {
      ownerSeat: input.ownerSeat,
      targetRef: ownerRef(input.ownerSeat),
      sourceSeat,
      result,
      attackId: input.metadata?.attackId ?? null,
      statusId: input.statusId,
      statusRef,
      durationId,
    });
    if (durationId)
      tx.emit("duration.created", {
        durationId,
        ownerSeat: input.ownerSeat,
        expiryPoint: definition.expiryPoint,
        skipPolicy: definition.skipPolicy,
      });
    if(
      input.statusId==="status.equipmentDisabled" &&
      equipmentWasEnabled &&
      !equipmentEnabled(draft,input.ownerSeat)
    ) setEquippedTalentContributionsEnabled(tx,input.ownerSeat,false);
  }
}
export function applyStatus(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: ApplyStatusInput,
): TransactionCommit<AuthoritativeGameState> {
  const tx = new EngineTransaction(state);
  applyStatusInTransaction(tx, ruleset, input);
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
export function statusPhaseDisposition(
  state: AuthoritativeGameState,
  seat: Seat,
  phase: Phase,
): { kind: "normal" } | { kind: "skip"; reason: string } {
  const status = state.players
    .find((item) => item.seat === seat)!
    .statuses.find((item) => item.skipPhases.includes(phase));
  return status
    ? { kind: "skip", reason: status.statusId }
    : { kind: "normal" };
}
export function expireStatusesAtPhaseAfter(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  phase: Phase,
  skipped: boolean,
): void {
  const draft = tx.draft,
    point = `owner.nextPhase.${phase}.after`,
    durations = draft.durations.filter(
      (item) =>
        item.ownerRef === ownerRef(seat) &&
        item.expiryPoint === point &&
        (item.skipPolicy === "expireOnSkippedBoundary" || !skipped),
    );
  for (const duration of durations) {
    const status = draft.players
      .find((item) => item.seat === seat)!
      .statuses.find((item) => item.durationId === duration.durationId);
    if (status) {
      const wasEquipmentDisabled=status.statusId==="status.equipmentDisabled";
      removeStatusAndDuration(draft, status);
      tx.emit("status.expired", {
        ownerSeat: seat,
        statusId: status.statusId,
        statusRef: status.statusRef,
        skipped,
      });
      if(
        wasEquipmentDisabled &&
        draft.players.find(item=>item.seat===seat)!.markers.equipmentEffectsDisabled!==true &&
        equipmentEnabled(draft,seat)
      ) setEquippedTalentContributionsEnabled(tx,seat,true);
    }
    tx.emit("duration.expired", {
      durationId: duration.durationId,
      point,
      skipped,
    });
  }
}
export function expireStatusesAtPhaseBefore(tx:EngineTransaction<AuthoritativeGameState>,seat:Seat,phase:Phase):void{const draft=tx.draft,accepted=new Set([`owner.nextPhase.${phase}.before`,`target.nextPhase.${phase}.before`]),durations=draft.durations.filter(item=>item.ownerRef===ownerRef(seat)&&accepted.has(item.expiryPoint));for(const duration of durations){const status=draft.players.find(item=>item.seat===seat)!.statuses.find(item=>item.durationId===duration.durationId);if(status){removeStatusAndDuration(draft,status);tx.emit("status.expired",{ownerSeat:seat,statusId:status.statusId,statusRef:status.statusRef,skipped:false,point:"before"});}tx.emit("duration.expired",{durationId:duration.durationId,point:duration.expiryPoint,skipped:false});}}
