const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { initializeServerTelemetry } = require("../server-telemetry");

function startBrowserTelemetry({ navigator = {}, screen, intl = Intl, connectionString = "InstrumentationKey=test" } = {}) {
  const envelopes = [];
  let sdk;
  class ApplicationInsights {
    constructor() {
      sdk = this;
      this.context = { user: { id: "anonymous-browser-123" }, getSessionId: () => "session-123" };
    }
    addTelemetryInitializer(initializer) { this.initializer = initializer; }
    loadAppInsights() {}
    capture(type, item) {
      const envelope = { baseType: type, baseData: item };
      this.initializer(envelope);
      envelopes.push(envelope);
    }
    trackPageView(item) { this.capture("PageviewData", item); }
    trackEvent(item) { this.capture("EventData", item); }
    trackException(item) { this.capture("ExceptionData", item); }
  }
  const window = {
    navigator, screen, Intl: intl,
    jeopardyTelemetryConfig: { connectionString },
    Microsoft: { ApplicationInsights: { ApplicationInsights } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../telemetry.js"), "utf8"), {
    window, document: { title: "Jeopardy" }, console
  });
  return { telemetry: window.jeopardyTelemetry, envelopes, sdk };
}

test("browser telemetry attaches independent serialized user context to page views, events, and errors", () => {
  const { telemetry, envelopes, sdk } = startBrowserTelemetry({
    navigator: {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.1.2",
      language: "en-US", languages: ["en-US", "en"]
    },
    screen: { width: 1920, height: 1080 },
    intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "America/New_York" }) }) }
  });
  telemetry.trackEvent("clue_cheated", { teamName: "The A Team" }, { answeredClues: 1 });
  telemetry.trackException(new Error("Failed"));
  const expectedUser = {
    anonymousId: "anonymous-browser-123",
    guestName: "Guest-anonymou",
    sessionId: "session-123",
    identity: { displayName: null, email: null, authenticatedId: null },
    browser: { name: "Edge", version: "130.0.1.2", language: "en-US", languages: ["en-US", "en"] },
    device: { type: "desktop", operatingSystem: "Windows", screen: { width: 1920, height: 1080 } },
    timeZone: "America/New_York",
    location: { city: null, region: null, country: null }
  };
  assert.equal(envelopes.length, 3);
  for (const envelope of envelopes) {
    assert.deepEqual(JSON.parse(envelope.data.user), expectedUser);
    assert.equal(envelope.tags["ai.cloud.role"], "mtb-jeopardy-web");
  }
  assert.equal(envelopes[1].baseData.properties.teamName, "The A Team");
  assert.equal(envelopes[1].baseData.measurements.answeredClues, 1);
  sdk.context.getSessionId = () => "next-session";
  telemetry.trackEvent("board_loaded");
  assert.equal(JSON.parse(envelopes[3].data.user).sessionId, "next-session");
});

test("missing browser context stays null without stopping telemetry", () => {
  const { telemetry, envelopes, sdk } = startBrowserTelemetry({
    intl: { DateTimeFormat() { throw new Error("time zone unavailable"); } }
  });
  sdk.context = {};
  telemetry.trackEvent("board_loaded");
  const user = JSON.parse(envelopes[1].data.user);
  assert.equal(user.anonymousId, null);
  assert.equal(user.guestName, null);
  assert.equal(user.sessionId, null);
  assert.equal(user.browser.name, null);
  assert.deepEqual(user.browser.languages, []);
  assert.equal(user.device.type, null);
  assert.deepEqual(user.device.screen, { width: null, height: null });
  assert.equal(user.timeZone, null);
});

test("browser context distinguishes mobile Safari, Android tablets, and desktop browsers", () => {
  const examples = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1", "Safari", "iOS", "mobile"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel Tablet) Chrome/130.0.0.0 Safari/537.36", "Chrome", "Android", "tablet"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox", "Linux", "desktop"]
  ];
  for (const [userAgent, browser, operatingSystem, type] of examples) {
    const { envelopes } = startBrowserTelemetry({ navigator: { userAgent } });
    const user = JSON.parse(envelopes[0].data.user);
    assert.equal(user.browser.name, browser);
    assert.equal(user.device.operatingSystem, operatingSystem);
    assert.equal(user.device.type, type);
  }
});

test("disabled browser telemetry does not collect user context", () => {
  const { telemetry, envelopes } = startBrowserTelemetry({
    connectionString: "",
    navigator: { get userAgent() { throw new Error("must not read browser context"); } }
  });
  assert.equal(telemetry.enabled, false);
  telemetry.trackEvent("board_loaded");
  assert.equal(envelopes.length, 0);
});

test("server telemetry remains disabled without an Application Insights connection string", () => {
  let startCalls = 0;
  const enabled = initializeServerTelemetry({
    environment: {},
    startAzureMonitor() {
      startCalls += 1;
    }
  });

  assert.equal(enabled, false);
  assert.equal(startCalls, 0);
});

test("server telemetry starts Azure Monitor with a stable service name", () => {
  const environment = {
    APPLICATIONINSIGHTS_CONNECTION_STRING: "InstrumentationKey=test-key"
  };
  const startCalls = [];

  const enabled = initializeServerTelemetry({
    environment,
    startAzureMonitor(options) {
      startCalls.push(options);
    }
  });

  assert.equal(enabled, true);
  assert.equal(environment.OTEL_SERVICE_NAME, "mtb-jeopardy-api");
  assert.deepEqual(startCalls, [{
    azureMonitorExporterOptions: {
      connectionString: "InstrumentationKey=test-key"
    }
  }]);
});
