import { describe, expect, it } from "vitest";
import { nextTheme, parseTheme, type Theme } from "@/lib/theme";

describe("parseTheme", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    [undefined, "system"],
    ["", "system"],
    ["system", "system"],
    ["Dark", "system"],
  ] as const)("%s → %s", (value, expected) => {
    expect(parseTheme(value)).toBe(expected);
  });
});

describe("nextTheme", () => {
  it("기기 설정 → 밝은 화면 → 어두운 화면 → 기기 설정으로 돈다", () => {
    const seen: Theme[] = ["system"];
    for (let i = 0; i < 3; i++) seen.push(nextTheme(seen[seen.length - 1]));
    expect(seen).toEqual(["system", "light", "dark", "system"]);
  });
});
