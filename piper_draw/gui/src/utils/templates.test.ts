import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDaeToBlocks } from "./daeImport";

const TEMPLATES_DIR = join(__dirname, "..", "..", "public", "templates");

describe("bundled tqec.gallery templates", () => {
  const manifest = JSON.parse(readFileSync(join(TEMPLATES_DIR, "manifest.json"), "utf8")) as {
    templates: { filename: string; name: string }[];
  };

  it("manifest matches the .dae files on disk", () => {
    const onDisk = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".dae")).sort();
    const inManifest = manifest.templates.map((t) => t.filename).sort();
    expect(inManifest).toEqual(onDisk);
  });

  for (const t of manifest.templates) {
    it(`${t.name} parses into at least one block`, () => {
      const xml = readFileSync(join(TEMPLATES_DIR, t.filename), "utf8");
      const blocks = parseDaeToBlocks(xml);
      expect(blocks.size).toBeGreaterThan(0);
    });
  }
});
