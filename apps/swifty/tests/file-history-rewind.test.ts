import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { FileHistory } from "../src/file-history/file-history.js";

function makeTempProject(): { base: string; projectDir: string } {
  const base = mkdtempSync(join(tmpdir(), "swifty-fh-"));
  const projectDir = join(base, "project");
  mkdirSync(projectDir, { recursive: true });
  return { base, projectDir };
}

describe("FileHistory rewind", () => {
  it("deletes a file created after the target snapshot", () => {
    const { base, projectDir } = makeTempProject();
    const fh = new FileHistory(base, "session-1");

    // Round 1: no file changes, pure conversation, take a snapshot.
    fh.makeSnapshot(0, "Round 1");

    // Round 2: create a new file. trackEdit is called before the write, when the file does not exist yet.
    const newFile = join(projectDir, "new-file.ts");
    fh.trackEdit(newFile);
    writeFileSync(newFile, "export const x = 1;");
    fh.makeSnapshot(2, "Round 2: new file created");

    expect(existsSync(newFile)).toBe(true);

    // Rewind to the round-1 snapshot, i.e. the state before this file was created.
    const changed = fh.rewind(0);

    expect(existsSync(newFile)).toBe(false);
    expect(changed).toContain(newFile);
  });

  it("restores an edit on an existing file", () => {
    const { base, projectDir } = makeTempProject();
    const fh = new FileHistory(base, "session-1");

    const existing = join(projectDir, "existing.ts");
    writeFileSync(existing, "original");

    fh.trackEdit(existing);
    fh.makeSnapshot(0, "Round 1: snapshot before modification");

    writeFileSync(existing, "modified");
    fh.makeSnapshot(2, "Round 2: content changed");

    const changed = fh.rewind(0);

    expect(readFileSync(existing, "utf-8")).toBe("original");
    expect(changed).toContain(existing);
  });

  it("keeps the created file when rewinding to its own snapshot", () => {
    const { base, projectDir } = makeTempProject();
    const fh = new FileHistory(base, "session-1");

    fh.makeSnapshot(0, "Round 1");

    const newFile = join(projectDir, "new-file.ts");
    fh.trackEdit(newFile);
    writeFileSync(newFile, "export const x = 1;");
    fh.makeSnapshot(2, "Round 2: new file created");

    // Rewinding to the snapshot taken after the file was created should keep the
    // file (with its content restored to what was written at that time).
    fh.rewind(1);

    expect(existsSync(newFile)).toBe(true);
    expect(readFileSync(newFile, "utf-8")).toBe("export const x = 1;");
  });
});
