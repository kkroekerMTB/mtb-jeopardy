(function initializeBrowserTelemetry(global) {
  "use strict";

  const noOpTelemetry = {
    enabled: false,
    trackEvent() {},
    trackException() {}
  };
  global.jeopardyTelemetry = noOpTelemetry;

  const connectionString = global.jeopardyTelemetryConfig?.connectionString;
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    return;
  }

  const ApplicationInsights = global.Microsoft?.ApplicationInsights?.ApplicationInsights;
  if (typeof ApplicationInsights !== "function") {
    console.warn("Application Insights browser SDK is unavailable.");
    return;
  }

  try {
    const appInsights = new ApplicationInsights({
      config: {
        connectionString,
        enableCorsCorrelation: true,
        enableUnhandledPromiseRejectionTracking: true
      }
    });

    appInsights.addTelemetryInitializer((envelope) => {
      envelope.tags = envelope.tags || {};
      envelope.tags["ai.cloud.role"] = "mtb-jeopardy-web";
    });
    appInsights.loadAppInsights();
    appInsights.trackPageView({ name: document.title });

    global.jeopardyTelemetry = {
      enabled: true,
      trackEvent(name, properties = {}, measurements = {}) {
        appInsights.trackEvent({ name, properties, measurements });
      },
      trackException(error, properties = {}) {
        const exception = error instanceof Error ? error : new Error(String(error));
        appInsights.trackException({ exception, properties });
      }
    };
  } catch (error) {
    console.warn("Application Insights browser telemetry could not start.", error);
  }
}(window));
