const fs = require("node:fs/promises");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");

async function buildSite(outputDirectory = path.join(repositoryRoot, "_site")) {
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.copyFile(
    path.join(repositoryRoot, "index.html"),
    path.join(outputDirectory, "index.html")
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
