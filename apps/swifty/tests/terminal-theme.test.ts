import { describe, expect, it } from "vitest";

import {
  parseOsc11BackgroundColor,
  parseTerminalColorSchemeReport,
  themeForRgb,
  themeFromEnvironment,
} from "@/bootstrap/terminal-theme.js";
import { DARK_THEME, LIGHT_THEME, setThemeMode, THEME } from "@/tui/styles.js";

describe("terminal theme detection", () => {
  it("parses terminal color scheme and OSC 11 responses", () => {
    expect(parseTerminalColorSchemeReport("\u001B[?997;2n")).toBe("light");
    expect(parseTerminalColorSchemeReport("\u001B[?997;1n")).toBe("dark");
    expect(parseOsc11BackgroundColor("\u001B]11;rgb:ffff/ffff/ffff\u0007")).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });

  it("classifies terminal backgrounds by luminance", () => {
    expect(themeForRgb({ r: 248, g: 248, b: 248 })).toBe("light");
    expect(themeForRgb({ r: 24, g: 24, b: 30 })).toBe("dark");
  });

  it("honors explicit theme and COLORFGBG", () => {
    expect(themeFromEnvironment({ SWIFTY_THEME: "light" })).toBe("light");
    expect(themeFromEnvironment({ COLORFGBG: "15;0" })).toBe("dark");
    expect(themeFromEnvironment({ COLORFGBG: "0;15" })).toBe("light");
  });

  it("updates message and tool backgrounds when switching themes", () => {
    setThemeMode("light");
    expect(THEME.userMessageBg).toBe(LIGHT_THEME.userMessageBg);
    expect(THEME.toolPendingBg).toBe(LIGHT_THEME.toolPendingBg);

    setThemeMode("dark");
    expect(THEME.userMessageBg).toBe(DARK_THEME.userMessageBg);
  });
});
