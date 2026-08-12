const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testIgnore: ["**/server.test.js", "**/build-site.test.js", "**/telemetry.test.js"],
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 5000
  },
  webServer: {
    command: "python3 -m http.server 4173",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "pipe"
  }
});
