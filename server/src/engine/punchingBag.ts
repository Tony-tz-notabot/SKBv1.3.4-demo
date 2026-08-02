import type { AuthoritativeGameState, Seat } from "./state.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
const KEY = "punchingBag.inertia.bySource";
function definition(ruleset: LoadedRuleset) {
  const rule = (
    ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects?: Array<{
          op?: string;
          params?: Record<string, unknown>;
          effects?: Array<{ op?: string; params?: Record<string, unknown> }>;
          maxIterations?: number;
        }>;
      }>;
    }
  ).rules.find((item) => item.ruleId === "character.punchingBag.inertiaSource");
  const repeat = rule?.effects?.find((effect) => effect.op === "repeat"),
    expression = String(repeat?.params?.count ?? ""),
    threshold = Number(/floor\(\$inertia\/(\d+)\)/.exec(expression)?.[1]),
    damage = Number(
      repeat?.effects?.find((effect) => effect.op === "createDamage")?.params
        ?.amount,
    ),
    maxIterations = Number(repeat?.maxIterations);
  if (
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    !Number.isInteger(damage) ||
    damage < 0 ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1
  )
    throw new Error("PUNCHING_BAG_INERTIA_RULE_INVALID");
  return { threshold, damage, maxIterations };
}
function values(
  state: AuthoritativeGameState,
  seat: Seat,
): Record<string, number> {
  const raw = state.players.find((p) => p.seat === seat)!.markers[KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => [k, Number(v)]),
  );
}
export function recordPunchingBagInertia(
  tx: EngineTransaction<AuthoritativeGameState>,
  targetSeat: Seat,
  sourceSeat: Seat | null,
  amount: number,
) {
  if (!sourceSeat || amount <= 0) return;
  const target = tx.draft.players.find((p) => p.seat === targetSeat)!;
  if (!target.skillIds.includes("skill.punching_bag.inertial_counter")) return;
  const by = values(tx.draft, targetSeat),
    key = String(sourceSeat),
    before = by[key] ?? 0;
  by[key] = before + amount;
  target.markers[KEY] = by as unknown as JsonValue;
  tx.emit("marker.changed", {
    seat: targetSeat,
    markerId: KEY,
    sourceSeat,
    from: before,
    to: by[key],
    delta: amount,
  });
}
export function queuePunchingBagInertiaAtSourceEnd(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  sourceSeat: Seat,
) {
  const config = definition(ruleset);
  const source = tx.draft.players.find((p) => p.seat === sourceSeat)!;
  for (const bag of tx.draft.players.filter((p) =>
    p.skillIds.includes("skill.punching_bag.inertial_counter"),
  )) {
    const by = values(tx.draft, bag.seat);
    for (const key of Object.keys(by)) {
      const owner = tx.draft.players.find((p) => p.seat === Number(key));
      if (owner?.lifeState === "eliminated") delete by[key];
    }
    const total = by[String(sourceSeat)] ?? 0;
    if (source.lifeState === "eliminated") {
      delete by[String(sourceSeat)];
    } else {
      const count = Math.min(
        config.maxIterations,
        Math.floor(total / config.threshold),
      );
      by[String(sourceSeat)] = total - count * config.threshold;
      for (let i = 0; i < count; i++) {
        const scheduledId = `scheduled:punching-bag-inertia:${bag.seat}:${sourceSeat}:${tx.draft.stateRevision + 1}:${i}`;
        tx.draft.scheduledEffects.push({
          scheduledId,
          sourceRef: `character:${bag.seat}`,
          controllerSeat: bag.seat,
          executeAt: "immediate.damagePipeline",
          effect: {
            op: "createDamage",
            targetRef: `character:${sourceSeat}`,
            amount: config.damage,
            damageType: "true",
            element: "none",
            attackType: "field",
            isAdditional: false,
            ignoreArmor: true,
          },
          cancelled: false,
        });
        tx.emit("effect.scheduled", {
          scheduledId,
          abilityId: "skill.punching_bag.inertial_counter",
          sourceSeat: bag.seat,
          targetSeat: sourceSeat,
          index: i,
        });
      }
    }
    bag.markers[KEY] = by as unknown as JsonValue;
    tx.emit("marker.changed", {
      seat: bag.seat,
      markerId: KEY,
      sourceSeat,
      to: by[String(sourceSeat)] ?? 0,
      spent:
        Math.min(config.maxIterations, Math.floor(total / config.threshold)) *
        config.threshold,
    });
  }
}
