import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ARROWS = new Set(["→", "↗", "↻", "←", "↓"]);
const TEXT_PRESENTATION_SELECTOR = "\uFE0E";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx|css)$/.test(entry) ? [path] : [];
  });
}

describe("arrow presentation", () => {
  it("forces every interface arrow to use monochrome text presentation", () => {
    const files = [...sourceFiles(join(process.cwd(), "app")), ...sourceFiles(join(process.cwd(), "components"))];
    const unprotected = files.flatMap((file) => {
      const characters = Array.from(readFileSync(file, "utf8"));
      return characters.flatMap((character, index) =>
        ARROWS.has(character) && characters[index + 1] !== TEXT_PRESENTATION_SELECTOR ? [`${file}:${index}`] : [],
      );
    });

    expect(unprotected).toEqual([]);
  });
});
