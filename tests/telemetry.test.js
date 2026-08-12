const { test } = require("node:test");
const assert = require("node:assert/strict");
const { initializeServerTelemetry } = require("../server-telemetry");

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
