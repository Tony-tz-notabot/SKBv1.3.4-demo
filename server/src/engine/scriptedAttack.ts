import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
export interface ScriptedAttackInput {
  attackId: string;
  attackerSeat: Seat;
  targetRef: string;
  sourceRef: string | null;
  weaponId: string;
  modeId: string;
  range: number | "unlimited";
  attackTypes: string[];
  damageSegments: JsonValue[];
  customJudgments?: JsonValue[];
  cannotMeleeBlock?: boolean;
  ignoreArmor?: boolean;
  tags?: string[];
  preserveTargetOrder?: boolean;
  costCardRefs?: string[];
  ignoreTalentModifiers?: boolean;
  resumePlayDeadlineAt?: number;
}
export interface ScriptedAttackTargetGroup {
  targetRef: string;
  attackTypes: string[];
  damageSegments: JsonValue[];
  cannotMeleeBlock?: boolean;
}
export function createScriptedAttackInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: ScriptedAttackInput,
): void {
  if (tx.draft.combat.attack) throw new Error("ATTACK_ALREADY_RESOLVING");
  const targetSeat = Number(input.targetRef.split(":")[1]) as Seat,
    target = tx.draft.players.find((item) => item.seat === targetSeat);
  if (
    !target ||
    target.lifeState === "eliminated" ||
    target.presence !== "inPlay"
  )
    throw new Error("ATTACK_TARGET_INVALID");
  const attack = {
    attackId: input.attackId,
    attackerSeat: input.attackerSeat,
    weaponRef: input.sourceRef,
    weaponId: input.weaponId,
    modeId: input.modeId,
    targetRefs: [input.targetRef],
    killCardRefs: [],
    costCardRefs: [...(input.costCardRefs ?? [])],
    range: input.range,
    attackTypes: [...input.attackTypes],
    responsePolicy: "standardAttack",
    damageSegments: structuredClone(input.damageSegments),
    ...(input.customJudgments
      ? { customJudgments: structuredClone(input.customJudgments) }
      : {}),
    ...(input.cannotMeleeBlock ? { cannotMeleeBlock: true } : {}),
    ...(input.ignoreArmor ? { ignoreArmor: true } : {}),
    ...(input.ignoreTalentModifiers ? { ignoreTalentModifiers: true } : {}),
    ...(typeof input.resumePlayDeadlineAt === "number"
      ? { resumePlayDeadlineAt: input.resumePlayDeadlineAt }
      : {}),
    tags: [...(input.tags ?? [])],
    status: "committed",
  };
  tx.draft.combat.attack = attack as unknown as JsonValue;
  tx.draft.combat.targetQueue = [input.targetRef];
  tx.draft.combat.currentTargetRef = input.targetRef;
  tx.emit("attack.declare", {
    attackId: input.attackId,
    attackerSeat: input.attackerSeat,
    sourceRef: input.sourceRef,
    scripted: true,
  });
  tx.emit("attack.targets.chosen", {
    attackId: input.attackId,
    targetRefs: [input.targetRef],
  });
  tx.emit("attack.costs.paid", {
    attackId: input.attackId,
    killCardRefs: [],
    attackCount: 0,
    costCardRefs: input.costCardRefs ?? [],
  });
  tx.emit("attack.commit", {
    attackId: input.attackId,
    attackerSeat: input.attackerSeat,
    scripted: true,
  });
}

export function createCompositeScriptedAttackInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: Omit<
    ScriptedAttackInput,
    "targetRef" | "attackTypes" | "damageSegments" | "cannotMeleeBlock"
  > & { targetGroups: ScriptedAttackTargetGroup[] },
): void {
  if (tx.draft.combat.attack) throw new Error("ATTACK_ALREADY_RESOLVING");
  if (!input.targetGroups.length) throw new Error("ATTACK_TARGETS_EMPTY");
  const distinct = new Set(input.targetGroups.map((group) => group.targetRef));
  if (distinct.size !== input.targetGroups.length)
    throw new Error("ATTACK_TARGETS_NOT_DISTINCT");
  for (const group of input.targetGroups) {
    const seat = Number(group.targetRef.split(":")[1]) as Seat,
      target = tx.draft.players.find((item) => item.seat === seat);
    if (
      !target ||
      target.lifeState === "eliminated" ||
      target.presence !== "inPlay"
    )
      throw new Error("ATTACK_TARGET_INVALID");
  }
  const ordered = input.preserveTargetOrder
      ? [...input.targetGroups]
      : [...input.targetGroups].sort((left, right) => {
          const leftSeat = Number(left.targetRef.split(":")[1]),
            rightSeat = Number(right.targetRef.split(":")[1]);
          return (
            ((leftSeat - input.attackerSeat + 4) % 4) -
            ((rightSeat - input.attackerSeat + 4) % 4)
          );
        }),
    first = ordered[0]!,
    profiles = Object.fromEntries(
      ordered.map((group) => [
        group.targetRef,
        {
          attackTypes: group.attackTypes,
          damageSegments: group.damageSegments,
          ...(group.cannotMeleeBlock ? { cannotMeleeBlock: true } : {}),
        },
      ]),
    );
  const attack = {
    attackId: input.attackId,
    attackerSeat: input.attackerSeat,
    weaponRef: input.sourceRef,
    weaponId: input.weaponId,
    modeId: input.modeId,
    targetRefs: ordered.map((group) => group.targetRef),
    killCardRefs: [],
    costCardRefs: [...(input.costCardRefs ?? [])],
    range: input.range,
    attackTypes: [...first.attackTypes],
    responsePolicy: "standardAttack",
    damageSegments: structuredClone(first.damageSegments),
    targetProfiles: structuredClone(profiles),
    ...(first.cannotMeleeBlock ? { cannotMeleeBlock: true } : {}),
    ...(input.ignoreArmor ? { ignoreArmor: true } : {}),
    ...(input.ignoreTalentModifiers ? { ignoreTalentModifiers: true } : {}),
    ...(typeof input.resumePlayDeadlineAt === "number"
      ? { resumePlayDeadlineAt: input.resumePlayDeadlineAt }
      : {}),
    tags: [...(input.tags ?? [])],
    status: "committed",
  };
  tx.draft.combat.attack = attack as unknown as JsonValue;
  tx.draft.combat.targetQueue = ordered.map((group) => group.targetRef);
  tx.draft.combat.currentTargetRef = first.targetRef;
  tx.emit("attack.declare", {
    attackId: input.attackId,
    attackerSeat: input.attackerSeat,
    sourceRef: input.sourceRef,
    scripted: true,
    composite: true,
  });
  tx.emit("attack.targets.chosen", {
    attackId: input.attackId,
    targetRefs: attack.targetRefs,
  });
  tx.emit("attack.costs.paid", {
    attackId: input.attackId,
    killCardRefs: [],
    costCardRefs: input.costCardRefs ?? [],
    attackCount: 0,
  });
  tx.emit("attack.commit", {
    attackId: input.attackId,
    attackerSeat: input.attackerSeat,
    scripted: true,
    composite: true,
  });
}
