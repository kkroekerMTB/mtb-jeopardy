const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildSite } = require("../scripts/build-site");

test("Pages artifact contains every local media file referenced by index.html", async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mtb-jeopardy-site-"));
  const outputDirectory = path.join(temporaryRoot, "_site");
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  await buildSite(outputDirectory);

  const html = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
  const mediaPaths = Array.from(html.matchAll(/(?:src|href)="(media\/[^"]+)"/g), (match) => match[1]);

  assert.ok(mediaPaths.length > 0, "index.html should reference at least one local media file");
  for (const mediaPath of mediaPaths) {
    await assert.doesNotReject(
      fs.access(path.join(outputDirectory, mediaPath)),
      `${mediaPath} should be included in the Pages artifact`
    );
  }
});
