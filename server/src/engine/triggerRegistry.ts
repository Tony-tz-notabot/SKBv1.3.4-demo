import type { LoadedRuleset } from "../ruleset/types.js";
import type {
  AuthoritativeGameState,
  CardInstanceState,
  Seat,
} from "./state.js";
import type { JsonValue } from "./types.js";

type RecordValue = Record<string, JsonValue>;
export type TriggerPriorityName =
  | "legality"
  | "replacement"
  | "prevention"
  | "mandatoryModifier"
  | "optionalModifier"
  | "ordinaryTrigger"
  | "cleanup";
const PRIORITY: Record<TriggerPriorityName, number> = {
  legality: 1000,
  replacement: 900,
  prevention: 800,
  mandatoryModifier: 700,
  optionalModifier: 600,
  ordinaryTrigger: 500,
  cleanup: 100,
};
export interface CompiledTriggerDefinition {
  triggerId: string;
  sourceFile: string;
  sourcePath: string;
  familyId: string;
  eventType: string;
  mandatory: boolean;
  optional: boolean;
  timing: string | null;
  scope: string | null;
  priorityName: TriggerPriorityName;
  priority: number;
  filter: RecordValue;
  costs: JsonValue[];
  effects: JsonValue[];
}
export interface TriggerEventFact {
  eventType: string;
  payload: RecordValue;
}
export interface MatchedTriggerCandidate extends CompiledTriggerDefinition {
  controllerSeat: Seat;
  sourceRef: string;
  sourceKind: "card" | "initialTalent";
  unsupportedFilterKeys: string[];
  requiresControllerOrdering: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const jsonRecord = (value: unknown): RecordValue =>
  isRecord(value) ? (value as RecordValue) : {};
function priorityFor(trigger: Record<string, unknown>): TriggerPriorityName {
  const effects = Array.isArray(trigger.effects)
      ? trigger.effects.filter(isRecord)
      : [],
    ops = effects.map((effect) => effect.op);
  if (ops.some((op) => op === "replaceEvent" || op === "invalidateAttack"))
    return "replacement";
  if (ops.some((op) => op === "preventEvent" || op === "preventDamage"))
    return "prevention";
  if (trigger.mandatory === true) return "mandatoryModifier";
  if (trigger.optional === true) return "optionalModifier";
  return "ordinaryTrigger";
}
export function compileTriggerRegistry(
  ruleset: LoadedRuleset,
): CompiledTriggerDefinition[] {
  const compiled: CompiledTriggerDefinition[] = [];
  for (const sourceFile of [
    "general-rules.json",
    "character-rules.json",
    "weapon-rules.json",
    "nonboss-rules.json",
    "boss-rules.json",
  ]) {
    const document = ruleset.documents.get(sourceFile);
    if (!document) continue;
    const walk = (
      value: unknown,
      path: Array<string | number>,
      familyId: string | null,
    ): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, [...path, index], familyId));
        return;
      }
      if (!isRecord(value)) return;
      const nextFamily =
        typeof value.familyId === "string" ? value.familyId : familyId;
      const append = (
        raw: unknown,
        triggerPath: Array<string | number>,
        index: number,
      ): void => {
        if (!isRecord(raw) || typeof raw.event !== "string" || !nextFamily)
          return;
        const priorityName = priorityFor(raw),
          sourcePath = triggerPath.join("."),
          explicitId = typeof raw.triggerId === "string" ? raw.triggerId : null;
        compiled.push({
          triggerId:
            explicitId ?? `${sourceFile}:${nextFamily}:${sourcePath}:${index}`,
          sourceFile,
          sourcePath,
          familyId: nextFamily,
          eventType: raw.event,
          mandatory: raw.mandatory === true,
          optional: raw.optional === true,
          timing: typeof raw.timing === "string" ? raw.timing : null,
          scope: typeof raw.scope === "string" ? raw.scope : null,
          priorityName,
          priority: PRIORITY[priorityName],
          filter: jsonRecord(raw.filter),
          costs: Array.isArray(raw.costs) ? (raw.costs as JsonValue[]) : [],
          effects: Array.isArray(raw.effects)
            ? (raw.effects as JsonValue[])
            : [],
        });
      };
      if (Array.isArray(value.triggers))
        value.triggers.forEach((trigger, index) =>
          append(trigger, [...path, "triggers", index], index),
        );
      if (isRecord(value.trigger))
        append(value.trigger, [...path, "trigger"], 0);
      for (const [key, child] of Object.entries(value))
        if (key !== "triggers" && key !== "trigger")
          walk(child, [...path, key], nextFamily);
    };
    walk(document, [], null);
  }
  const ids = compiled.map((item) => item.triggerId);
  if (new Set(ids).size !== ids.length) throw new Error("TRIGGER_ID_DUPLICATE");
  return compiled.sort(
    (left, right) =>
      left.sourceFile.localeCompare(right.sourceFile) ||
      left.sourcePath.localeCompare(right.sourcePath),
  );
}

const activeZoneTypes = new Set([
  "weaponSlot",
  "thirdWeaponSlot",
  "armorSlot",
  "mountOffenseSlot",
  "mountDefenseSlot",
  "talentZone",
  "bossSlot",
]);
function equipmentEnabled(state: AuthoritativeGameState, seat: Seat): boolean {
  const player = state.players.find((item) => item.seat === seat)!;
  return (
    player.markers.equipmentEffectsDisabled !== true &&
    !player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  );
}
function activeSources(
  state: AuthoritativeGameState,
  definition: CompiledTriggerDefinition,
): Array<{
  controllerSeat: Seat;
  sourceRef: string;
  sourceKind: "card" | "initialTalent";
  card?: CardInstanceState;
}> {
  const sources: Array<{
    controllerSeat: Seat;
    sourceRef: string;
    sourceKind: "card" | "initialTalent";
    card?: CardInstanceState;
  }> = [];
  for (const player of state.players)
    if (player.initialTalentIds.includes(definition.familyId))
      sources.push({
        controllerSeat: player.seat,
        sourceRef: `initialTalent:${player.seat}:${definition.familyId}`,
        sourceKind: "initialTalent",
      });
  for (const card of Object.values(state.cards)) {
    if (card.templateId !== definition.familyId || card.controllerSeat === null)
      continue;
    const zone = state.zones[card.zoneRef];
    if (!zone || !activeZoneTypes.has(zone.zoneType)) continue;
    if (
      zone.zoneType !== "bossSlot" &&
      !equipmentEnabled(state, card.controllerSeat)
    )
      continue;
    sources.push({
      controllerSeat: card.controllerSeat,
      sourceRef: card.cardRef,
      sourceKind: "card",
      card,
    });
  }
  return sources;
}
const numberField = (
  payload: RecordValue,
  ...keys: string[]
): number | null => {
  for (const key of keys)
    if (typeof payload[key] === "number") return payload[key] as number;
  return null;
};
const stringField = (
  payload: RecordValue,
  ...keys: string[]
): string | null => {
  for (const key of keys)
    if (typeof payload[key] === "string") return payload[key] as string;
  return null;
};
function filterOne(
  state: AuthoritativeGameState,
  source: ReturnType<typeof activeSources>[number],
  definition: CompiledTriggerDefinition,
  event: TriggerEventFact,
): { matched: boolean; unsupported: string[] } {
  const unsupported: string[] = [],
    payload = event.payload,
    controller = state.players.find(
      (player) => player.seat === source.controllerSeat,
    )!,
    actorSeat = numberField(payload, "actorSeat", "seat", "prioritySeat"),
    targetRef = stringField(payload, "targetRef", "dyingRef"),
    targetSeat = targetRef
      ? Number(targetRef.split(":")[1])
      : numberField(payload, "targetSeat", "ownerSeat"),
    sourceSeat = numberField(payload, "sourceSeat", "attackerSeat"),
    attack =
      state.combat.attack &&
      typeof state.combat.attack === "object" &&
      !Array.isArray(state.combat.attack)
        ? (state.combat.attack as RecordValue)
        : null;
  let matched = true;
  for (const [key, expected] of Object.entries(definition.filter)) {
    let actual: boolean | string | number | null = null,
      supported = true,
      expectedValue: JsonValue = expected;
    if (key === "phase") actual = stringField(payload, "phase") ?? state.phase;
    else if (key === "actorIsController")
      actual = actorSeat === source.controllerSeat;
    else if (key === "actorIsOtherInPlayCharacter")
      actual =
        actorSeat !== null &&
        actorSeat !== source.controllerSeat &&
        state.players.some(
          (player) =>
            player.seat === actorSeat &&
            player.lifeState !== "eliminated" &&
            player.presence === "inPlay",
        );
    else if (key === "lifeState") actual = controller.lifeState;
    else if (key === "ownerLifeState") actual = controller.lifeState;
    else if (key === "targetIsController")
      actual = targetSeat === source.controllerSeat;
    else if (
      key === "sourceIsController" ||
      key === "attackSourceIsController" ||
      key === "sourceIsAbilityOwner"
    )
      actual =
        (sourceSeat ?? Number(attack?.attackerSeat)) === source.controllerSeat;
    else if (key === "controllerIsResponder")
      actual =
        numberField(payload, "seat", "responderSeat") === source.controllerSeat;
    else if (key === "tag") {
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      actual = tags.includes(expected);
      expectedValue = true;
    }
    else if (key === "statusId") actual = stringField(payload, "statusId");
    else if (key === "resultIn" && Array.isArray(expected)) {
      actual = expected.includes(
        stringField(payload, "result") ??
          event.eventType.split(".").at(-1) ??
          "",
      );
      expectedValue = true;
    } else if (key === "bossActive")
      actual = source.card?.runtime.active === true;
    else if (key === "limitAvailable")
      actual = source.card
        ? source.card.runtime.triggerLimitConsumed !== true
        : controller.limits[`${definition.familyId}.perInstanceConsumed`] !== true;
    else if (key === "cardIsThisBoss" || key === "cardIsThisTalent")
      actual = stringField(payload, "cardRef") === source.sourceRef;
    else if (key === "controllerOwnedLostCard")
      actual =
        numberField(payload, "ownerSeat", "seat", "controllerSeat") ===
        source.controllerSeat;
    else if (key === "lostCardWasEquippedIn") {
      const fromZoneRef = stringField(payload, "fromZoneRef");
      actual = fromZoneRef
        ? (state.zones[fromZoneRef]?.zoneType ??
          (fromZoneRef.startsWith("armor:") ? "armorSlot" : null))
        : null;
    } else if (key === "attackType" || key === "parentAttackType") {
      const types = Array.isArray(payload.attackTypes)
        ? payload.attackTypes
        : Array.isArray(attack?.attackTypes)
          ? attack.attackTypes
          : [];
      actual = types.includes(expected);
      expectedValue = true;
    } else if (key === "attackIsCritical") actual = attack?.critical === true;
    else if (key === "attackLacksTag") {
      actual = !(Array.isArray(attack?.tags) && attack.tags.includes(expected));
      expectedValue = true;
    } else if (key === "weaponAttack")
      actual = typeof attack?.weaponRef === "string";
    else if (key === "damageAmountPositive")
      actual =
        (numberField(payload, "amount", "finalDamage", "actualDamage") ?? 0) >
        0;
    else if (key === "aggregateCrossedThreshold") {
      actual =
        (numberField(payload, "aggregateActualHpLoss", "actualHpLoss") ?? 0) >=
        Number(expected);
      expectedValue = true;
    }
    else if (key === "regularWeaponCountAboveCapacity") {
      const regularWeaponCount = Object.values(state.zones)
        .filter(
          (zone) =>
            zone.ownerSeat === source.controllerSeat &&
            zone.zoneType === "weaponSlot",
        )
        .reduce((count, zone) => count + zone.orderedCardRefs.length, 0);
      actual = regularWeaponCount > 2;
    } else if (key === "causedByDamage")
      actual =
        event.eventType === "shield.broken" &&
        (typeof payload.attackId === "string" ||
          typeof payload.segmentId === "string" ||
          typeof payload.damageId === "string");
    else if (key === "sourceHasDismantlableCard") {
      const damageSourceSeat =
        sourceSeat ??
        (typeof attack?.attackerSeat === "number"
          ? (attack.attackerSeat as number)
          : null);
      actual =
        damageSourceSeat !== null &&
        Object.values(state.zones).some(
          (zone) =>
            zone.ownerSeat === damageSourceSeat &&
            activeZoneTypes.has(zone.zoneType) &&
            zone.orderedCardRefs.length > 0,
        );
    } else if (
      key in payload &&
      ["string", "number", "boolean"].includes(typeof expected)
    )
      actual = payload[key] as string | number | boolean;
    else supported = false;
    if (!supported) unsupported.push(key);
    else if (actual !== expectedValue) matched = false;
  }
  return { matched: matched && unsupported.length === 0, unsupported };
}
const seatOrder = (activeSeat: Seat | null, seat: Seat): number =>
  activeSeat === null ? seat - 1 : (seat - activeSeat + 4) % 4;
export function matchTriggeredEffects(
  state: AuthoritativeGameState,
  registry: readonly CompiledTriggerDefinition[],
  event: TriggerEventFact,
): MatchedTriggerCandidate[] {
  const candidates: MatchedTriggerCandidate[] = [];
  for (const definition of registry) {
    if (definition.eventType !== event.eventType) continue;
    const sources = activeSources(state, definition);
    const lostFamily =
      event.eventType === "card.lost" &&
      typeof event.payload.lostFamilyId === "string"
        ? event.payload.lostFamilyId
        : null;
    const lostRef =
      typeof event.payload.cardRef === "string" ? event.payload.cardRef : null;
    const lostSeat =
      typeof event.payload.ownerSeat === "number"
        ? (event.payload.ownerSeat as Seat)
        : typeof event.payload.seat === "number"
          ? (event.payload.seat as Seat)
          : null;
    if (
      lostFamily === definition.familyId &&
      lostRef &&
      lostSeat &&
      !sources.some((source) => source.sourceRef === lostRef)
    )
      sources.push({
        controllerSeat: lostSeat,
        sourceRef: lostRef,
        sourceKind: "card",
      });
    for (const source of sources) {
      const evaluation = filterOne(state, source, definition, event);
      if (!evaluation.matched) continue;
      candidates.push({
        ...definition,
        ...source,
        unsupportedFilterKeys: evaluation.unsupported,
        requiresControllerOrdering: false,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.priority - left.priority ||
      seatOrder(state.activeSeat, left.controllerSeat) -
        seatOrder(state.activeSeat, right.controllerSeat) ||
      left.triggerId.localeCompare(right.triggerId) ||
      left.sourceRef.localeCompare(right.sourceRef),
  );
  for (const candidate of candidates)
    candidate.requiresControllerOrdering =
      candidates.filter(
        (other) =>
          other.priority === candidate.priority &&
          other.controllerSeat === candidate.controllerSeat,
      ).length > 1;
  return candidates;
}
