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

  function getBrowserContext() {
    const navigator = global.navigator || {};
    const userAgent = navigator.userAgent || "";
    const browserPatterns = [
      ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
      ["Opera", /(?:OPR|OPiOS)\/([\d.]+)/],
      ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
      ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
      ["Safari", /Version\/([\d.]+).*Safari/]
    ];
    let browserName = null;
    let browserVersion = null;
    for (const [name, pattern] of browserPatterns) {
      const match = userAgent.match(pattern);
      if (match) {
        browserName = name;
        browserVersion = match[1];
        break;
      }
    }

    const isIPad = /iPad/.test(userAgent) ||
      (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
    let operatingSystem = null;
    if (/iPhone|iPod/.test(userAgent) || isIPad) operatingSystem = "iOS";
    else if (/Android/.test(userAgent)) operatingSystem = "Android";
    else if (/Windows/.test(userAgent)) operatingSystem = "Windows";
    else if (/CrOS/.test(userAgent)) operatingSystem = "Chrome OS";
    else if (/Macintosh|Mac OS X/.test(userAgent)) operatingSystem = "macOS";
    else if (/Linux/.test(userAgent)) operatingSystem = "Linux";

    let timeZone = null;
    try {
      timeZone = global.Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      // Time zone information is optional in restricted browsers.
    }

    return {
      browser: {
        name: browserName,
        version: browserVersion,
        language: navigator.language || null,
        languages: Array.from(navigator.languages || [])
      },
      device: {
        type: isIPad || /Tablet|Android(?!.*Mobile)/.test(userAgent) ? "tablet" :
          /Mobile|iPhone|iPod/.test(userAgent) ? "mobile" :
            operatingSystem ? "desktop" : null,
        operatingSystem,
        screen: {
          width: global.screen?.width ?? null,
          height: global.screen?.height ?? null
        }
      },
      timeZone
    };
  }

  try {
    const browserContext = getBrowserContext();
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
      const anonymousId = appInsights.context?.user?.id || null;
      envelope.data = envelope.data || {};
      envelope.data.user = JSON.stringify({
        anonymousId,
        guestName: anonymousId ? `Guest-${anonymousId.slice(0, 8)}` : null,
        sessionId: appInsights.context?.getSessionId?.() || null,
        identity: { displayName: null, email: null, authenticatedId: null },
        ...browserContext,
        location: { city: null, region: null, country: null }
      });
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
