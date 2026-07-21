/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { describe, it, expect } from "vitest";
import { runInline } from "../src/skills/executor.js";
import type { Skill, SkillHost } from "../src/skills/skill.js";

function makeHost() {
  const activated: [string, string][] = [];
  const host: SkillHost = {
    activateSkill: (n, b) => activated.push([n, b]),
  };
  return { host, activated };
}

function skill(body: string): Skill {
  return {
    meta: { name: "demo", description: "d" },
    body,
    sourceDir: "",
    isDirectory: false,
  };
}

describe("skills runInline", () => {
  it("substitutes $ARGUMENTS and activates the skill", () => {
    const { host, activated } = makeHost();
    const body = runInline(skill("Do $ARGUMENTS now."), "the thing", host);

    expect(body).toBe("Do the thing now.");
    expect(activated[0][0]).toBe("demo");
    expect(activated[0][1]).toBe("Do the thing now.");
  });

  it("appends a User Request fallback when there is no placeholder", () => {
    const { host } = makeHost();
    const body = runInline(skill("SOP body"), "extra context", host);
    expect(body).toContain("SOP body");
    expect(body).toContain("User Request: extra context");
  });
});
