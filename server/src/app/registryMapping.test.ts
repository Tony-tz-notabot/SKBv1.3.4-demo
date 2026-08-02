import { describe, expect, it } from "vitest";
import { buildPlayCommand, type RawPlayOffer } from "./playRegistry.js";
import { buildWindowCommand } from "./windowRegistry.js";

const base = {
  commandId: "cmd",
  gameId: "game",
  expectedStateRevision: 1,
  actorUserId: "u1",
  promptId: "prompt",
  offerId: "offer",
};

describe("playRegistry command mapping", () => {
  it("maps SheepSynthesis to the Session's boyRef/girlRef fields", () => {
    const raw = {
      offerId: "offer:synthesize:special.sp03:1",
      boyRefs: ["card:1"],
      girlRefs: ["card:2"],
    } as RawPlayOffer;
    const command = buildPlayCommand(raw, {
      ...base,
      offerId: raw.offerId,
      selections: { cards: ["card:2", "card:1"] },
    });
    expect(command.boyRef).toBe("card:1");
    expect(command.girlRef).toBe("card:2");
    expect(command.cardRefs).toEqual(["card:2", "card:1"]);
  });

  it("maps DarkKnight attack targets to targetSeat", () => {
    const raw = {
      offerId: "offer:dark-knight:attack:thrust",
      legalTargetSeats: [2, 3],
    } as RawPlayOffer;
    const command = buildPlayCommand(raw, {
      ...base,
      offerId: raw.offerId,
      selections: { targets: ["character:3"] },
    });
    expect(command.targetSeat).toBe(3);
    expect(command.targetRef).toBe("character:3");
  });

  it("maps MechAttack killCards to killCardRef", () => {
    const raw = {
      offerId: "offer:engineer-mech-attack:prototype",
      legalKillCardRefs: ["card:9"],
      legalTargetRefs: ["character:2"],
    } as RawPlayOffer;
    const command = buildPlayCommand(raw, {
      ...base,
      offerId: raw.offerId,
      selections: { killCards: ["card:9"], targets: ["character:2"] },
    });
    expect(command.killCardRef).toBe("card:9");
    expect(command.killCardRefs).toEqual(["card:9"]);
    expect(command.targetRef).toBe("character:2");
  });

  it("maps furnace weapon selections to weaponRef", () => {
    const raw = {
      offerId: "offer:special.sp06:card:8",
      cardRef: "card:8",
      legalWeaponRefs: ["card:10"],
    } as RawPlayOffer;
    const command = buildPlayCommand(raw, {
      ...base,
      offerId: raw.offerId,
      selections: { weapons: ["card:10"] },
    });
    expect(command.weaponRef).toBe("card:10");
  });
});

describe("windowRegistry command mapping", () => {
  it("maps cards to CriticalPenetration killCardRef", () => {
    const command = buildWindowCommand({
      ...base,
      selections: { cards: ["card:11"], targets: ["character:4"] },
    });
    expect(command.killCardRef).toBe("card:11");
    expect(command.targetRef).toBe("character:4");
    expect(command.targetSeat).toBe(4);
  });

  it("maps Demolition cards to selectedWeaponRefs", () => {
    const command = buildWindowCommand({
      ...base,
      selections: { cards: ["card:12", "card:13"] },
    });
    expect(command.selectedWeaponRefs).toEqual(["card:12", "card:13"]);
    expect(command.selectedWeaponRef).toBe("card:12");
  });

  it("maps Reforge selection cards to selectedWeaponRef", () => {
    const command = buildWindowCommand({
      ...base,
      selections: { cards: ["card:14"] },
    });
    expect(command.selectedWeaponRef).toBe("card:14");
    expect(command.cardRef).toBe("card:14");
  });
});
