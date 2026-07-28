#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const { refreshGameData } = require("./game-refresh");

const J_ARCHIVE_HOME_URL = process.env.J_ARCHIVE_HOME_URL || "https://www.j-archive.com/";
const SCORES_API_URL = process.env.SCORES_API_URL ||
  "https://app-mtb-jeopardy-ftdbbcefh2dqd9d0.canadaeast-01.azurewebsites.net/api/source-episodes";
const CURRENT_GAME_DATA_URL = process.env.CURRENT_GAME_DATA_URL || "";
const OUTPUT_PATH = process.env.JEOPARDY_DATA_PATH || path.join("data", "latest-game.json");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const board = await refreshGameData({
      page,
      fetchImpl: fetch,
      now: new Date(),
      jArchiveHomeUrl: J_ARCHIVE_HOME_URL,
      scoresApiUrl: SCORES_API_URL,
      currentGameDataUrl: CURRENT_GAME_DATA_URL
    });
    await writeJson(OUTPUT_PATH, board);
    console.log("Wrote " + OUTPUT_PATH + " from " + board.episodeUrl);
  } finally {
    await browser.close();
  }
}

async function writeJson(outputPath, payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
