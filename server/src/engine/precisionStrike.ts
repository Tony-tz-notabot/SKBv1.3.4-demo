import type { LoadedRuleset } from "../ruleset/types.js";
import { beginJudgment, type PrintedColor } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
const ID = "talent.precision_strike";
const effective = (s: AuthoritativeGameState, n: Seat) => {
  const p = s.players.find((x) => x.seat === n)!;
  return (
    p.initialTalentIds.includes(ID) ||
    (p.markers.equipmentEffectsDisabled !== true &&
      !p.statuses.some((status) => status.statusId === "status.equipmentDisabled") &&
      (s.zones[`talent:${n}`]?.orderedCardRefs ?? []).some(
        (ref) => s.cards[ref]?.templateId === ID,
      ))
  );
};
export function beginPrecisionStrikeJudgment(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  deadlineAt: number,
) {
  const raw = s.combat.attack;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    s.pendingWindows.length ||
    s.resolutionStack.length
  )
    return null;
  const a = raw as Record<string, JsonValue>,
    seat = Number(a.attackerSeat) as Seat,
    targetRef = s.combat.currentTargetRef,
    key = `${String(a.attackId)}:${targetRef}`;
  if (
    a.status !== "committed" ||
    typeof a.weaponRef !== "string" ||
    !targetRef ||
    !effective(s, seat) ||
    a.precisionStrikeTargetKey === key
  )
    return null;
  const tx = new EngineTransaction(s),
    draft = tx.draft.combat.attack as Record<string, JsonValue>;
  draft.precisionStrikeTargetKey = key;
  const marked = tx.commit(),
    input = {
      controllerSeat: seat,
      sourceRef: `character:${seat}`,
      purpose: "precisionStrikeCritical",
      matchColors: ["red", "orange"] as PrintedColor[],
      context: {
        attackId: String(a.attackId),
        targetRef,
        resumeAttackStatus: "committed",
        judgmentRuleId: "talent.precision_strike",
        effectsByColor: {
          red: [
            { op: "applyCritical", params: {} },
            {
              op: "applyRestriction",
              params: { restrictionId: "noHandDodgeForAttack" },
            },
          ],
          orange: [
            { op: "applyCritical", params: {} },
            {
              op: "applyRestriction",
              params: { restrictionId: "noHandDodgeForAttack" },
            },
          ],
          white: [],
          green: [],
          blue: [],
        },
      },
    };
  const opened =
    openPreJudgmentWindow(marked.state, r, input, deadlineAt) ??
    beginJudgment(marked.state, r, input, deadlineAt);
  return {
    previousRevision: marked.previousRevision,
    state: opened.state,
    events: [...marked.events, ...opened.events],
  };
}
