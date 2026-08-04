import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { finalizeJudgment } from "./judgment.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import {
  finishStatueEffectFlow,
  StatuePlaySession,
} from "./statueDoubleTrigger.js";
import {StatueResolutionSession} from "./statueEffects.js";
let r: LoadedRuleset;
beforeAll(async () => {
  r = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
describe("statue double trigger", () => {
  it("returns a blue-matched statue after its flow even when the statue effect is invalidated", () => {
    let s = createInitialSetup(r, {
      gameId: "double-statue",
      firstSeat: 1,
      seed: 3901,
      usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
      characterIdsBySeat: {
        1: "character.knight",
        2: "character.ranger",
        3: "character.shaman",
        4: "character.druid",
      },
    });
    for(const seat of [1,2,3,4] as const)s=resolveInitialRedraw(s,seat,false,r).state;
    s.players[2]!.markers.defyFateUsed = true;
    Object.assign(s,{activeSeat:1,phase:"play",phaseBoundary:"body",phaseMode:"manual",phaseBodyResolved:false});
    s.pendingWindows=[{promptId:"play",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:900,timeoutPolicy:"pass",legalOfferIds:["offer:playPhaseAction:finish"],context:{}}];
    s.players[0]!.initialTalentIds.push("talent.statue_double_trigger");
    for(const seat of[1,2,3,4]as const)for(const ref of[...s.zones[`hand:${seat}`]!.orderedCardRefs])if(s.cards[ref]!.templateId.startsWith("statue.paladin.")){const z=s.zones[s.cards[ref]!.zoneRef]!;z.orderedCardRefs.splice(z.orderedCardRefs.indexOf(ref),1);s.zones.drawPile!.orderedCardRefs.push(ref);Object.assign(s.cards[ref]!,{zoneRef:"drawPile",ownerSeat:null,controllerSeat:null,faceUp:false});}
    const statue = Object.values(s.cards).find((x) =>
        x.templateId.startsWith("statue.wizard."),
      )!,
      z = s.zones[statue.zoneRef]!;
    z.orderedCardRefs.splice(z.orderedCardRefs.indexOf(statue.cardRef), 1);
    s.zones["hand:1"]!.orderedCardRefs.push(statue.cardRef);
    Object.assign(statue, {
      zoneRef: "hand:1",
      ownerSeat: 1,
      controllerSeat: 1,
      faceUp: true,
    });
    const session=new StatuePlaySession(s,r),played=session.handle({commandId:"play-statue",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:`offer:statue-play:${statue.cardRef}`,cardRef:statue.cardRef},900);
    expect(played.accepted).toBe(true);
    expect(session.state.cards[statue.cardRef]!.zoneRef).toBe("resolving");
    let state = finalizeJudgment(session.state, "blue").state;
    expect(state.cards[statue.cardRef]!.runtime.returnAfterStatue).toBe(true);
    // 判蓝后自动进入效果解析窗口，执行后按双触回手
    const window=state.pendingWindows[0]!;
    expect(window.kind).toBe("statueResolutionChoice");
    const choice=new StatueResolutionSession(state,r),chosen=choice.handle({commandId:"resolve-statue",gameId:state.gameId,expectedStateRevision:state.stateRevision,actorUserId:"u1",offerId:window.legalOfferIds[0]!,statueRef:statue.cardRef},900);
    expect(chosen.accepted).toBe(true);
    state=choice.state;
    expect(state.cards[statue.cardRef]!.zoneRef).toBe("hand:1");
    expect(state.pendingWindows[0]).toMatchObject({kind:"playPhaseAction",prioritySeat:1});
  });
});
