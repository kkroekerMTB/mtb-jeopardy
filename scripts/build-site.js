const fs = require("node:fs/promises");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const browserSdkSource = path.join(
  repositoryRoot,
  "node_modules",
  "@microsoft",
  "applicationinsights-web",
  "browser",
  "es5",
  "ai.3.gbl.min.js"
);
const developmentSdkPath = "node_modules/@microsoft/applicationinsights-web/browser/es5/ai.3.gbl.min.js";
const deployedSdkPath = "assets/applicationinsights-web.min.js";

async function buildSite(
  outputDirectory = path.join(repositoryRoot, "_site"),
  options = {}
) {
  const browserTelemetryConnectionString = options.browserTelemetryConnectionString ??
    process.env.APPLICATIONINSIGHTS_WEB_CONNECTION_STRING ??
    "";

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(path.join(outputDirectory, "assets"), { recursive: true });

  const sourceHtml = await fs.readFile(path.join(repositoryRoot, "index.html"), "utf8");
  await fs.writeFile(
    path.join(outputDirectory, "index.html"),
    sourceHtml.replace(developmentSdkPath, deployedSdkPath)
  );
  await fs.copyFile(browserSdkSource, path.join(outputDirectory, deployedSdkPath));
  await fs.copyFile(
    path.join(repositoryRoot, "telemetry.js"),
    path.join(outputDirectory, "telemetry.js")
  );
  await fs.writeFile(
    path.join(outputDirectory, "telemetry-config.js"),
    `window.jeopardyTelemetryConfig = ${JSON.stringify({
      connectionString: browserTelemetryConnectionString
    })};\n`
  );
  await fs.cp(
    path.join(repositoryRoot, "data"),
    path.join(outputDirectory, "data"),
    { recursive: true }
  );
  await fs.cp(
    path.join(repositoryRoot, "media"),
    path.join(outputDirectory, "media"),
    { recursive: true }
  );
}

if (require.main === module) {
  buildSite().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildSite };
