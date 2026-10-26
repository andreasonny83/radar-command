import { describe, expect, it } from "vitest";
import { FIRST_SEASON, nextSeason, SEASON_SECONDS, seasonAt } from "./seasons";

describe("seasons", () => {
  it("opens in the starting season and changes every two game days", () => {
    expect(seasonAt(0, "autumn").season).toBe("autumn");
    expect(seasonAt(SEASON_SECONDS - 1, "autumn").season).toBe("autumn");
    expect(seasonAt(SEASON_SECONDS, "autumn").season).toBe("winter");
    expect(seasonAt(SEASON_SECONDS * 2, "autumn").season).toBe("spring");
  });

  it("wraps winter to spring and cycles back after a year", () => {
    expect(nextSeason("winter")).toBe("spring");
    expect(seasonAt(SEASON_SECONDS * 4, "summer").season).toBe("summer");
  });

  it("holds a season steady, then slides into the next at its end", () => {
    expect(seasonAt(SEASON_SECONDS * 0.5, "spring").blend).toBe(0);
    const late = seasonAt(SEASON_SECONDS * 0.99, "spring");
    expect(late.blend).toBeGreaterThan(0.9);
    expect(late.next).toBe("summer");
    expect(seasonAt(SEASON_SECONDS, "spring").blend).toBe(0);
  });

  it("opens every shift in summer and runs summer, autumn, winter, spring", () => {
    expect(FIRST_SEASON).toBe("summer");
    const order = [0, 1, 2, 3].map((i) => seasonAt(i * SEASON_SECONDS, FIRST_SEASON).season);
    expect(order).toEqual(["summer", "autumn", "winter", "spring"]);
  });
});
