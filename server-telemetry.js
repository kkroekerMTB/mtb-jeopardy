function initializeServerTelemetry({
  environment = process.env,
  startAzureMonitor
} = {}) {
  const connectionString = environment.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    return false;
  }

  environment.OTEL_SERVICE_NAME ||= "mtb-jeopardy-api";
  const start = startAzureMonitor || require("@azure/monitor-opentelemetry").useAzureMonitor;
  start({
    azureMonitorExporterOptions: {
      connectionString
    }
  });
  return true;
}

module.exports = { initializeServerTelemetry };
