const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowsDirectory = path.resolve(__dirname, "..", ".github", "workflows");

test("GitHub workflows use Node 24-compatible action releases", () => {
  const workflows = fs.readdirSync(workflowsDirectory)
    .filter((fileName) => /\.ya?ml$/.test(fileName))
    .map((fileName) => ({
      fileName,
      contents: fs.readFileSync(path.join(workflowsDirectory, fileName), "utf8")
    }));
  workflows.push({
    fileName: "main_app-mtb-jeopardy.yml",
    contents: fs.readFileSync(path.resolve(__dirname, "..", "main_app-mtb-jeopardy.yml"), "utf8")
  });

  const deprecatedActions = [
    /actions\/checkout@v[1-4]\b/,
    /actions\/setup-node@v[1-4]\b/,
    /actions\/(?:upload|download)-artifact@v[1-5]\b/,
    /actions\/upload-pages-artifact@v[1-4]\b/,
    /actions\/deploy-pages@v[1-4]\b/
  ];

  for (const workflow of workflows) {
    for (const deprecatedAction of deprecatedActions) {
      assert.doesNotMatch(
        workflow.contents,
        deprecatedAction,
        `${workflow.fileName} should not use ${deprecatedAction}`
      );
    }
  }
});
