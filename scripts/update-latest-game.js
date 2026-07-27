#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const { parseEpisodeInPage, finalizeBoard } = require("./game-data");

const J_ARCHIVE_HOME_URL = process.env.J_ARCHIVE_HOME_URL || "https://www.j-archive.com/";
const OUTPUT_PATH = process.env.JEOPARDY_DATA_PATH || path.join("data", "latest-game.json");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const episodeUrls = await findEpisodeUrls(page);
    const board = await loadFirstAvailableBoard(page, episodeUrls);
    await writeJson(OUTPUT_PATH, board);
    console.log("Wrote " + OUTPUT_PATH + " from " + board.episodeUrl);
  } finally {
    await browser.close();
  }
}

async function findEpisodeUrls(page) {
  await page.goto(J_ARCHIVE_HOME_URL, { waitUntil: "domcontentloaded" });

  const archiveHref = await page.evaluate(() => {
    const recentLink = document.querySelector("body > table > tbody > tr > td > p:nth-child(3) > a:last-child");
    return recentLink ? recentLink.getAttribute("href") : "";
  });

  if (!archiveHref) {
    throw new Error("Recent episodes link not found on J-Archive home page.");
  }

  const archiveUrl = resolveUrl(archiveHref, J_ARCHIVE_HOME_URL);
  await page.goto(archiveUrl, { waitUntil: "domcontentloaded" });

  const episodeHrefs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("#content > table > tbody > tr > td:first-child > a"))
      .map((link) => link.getAttribute("href"))
      .filter(Boolean);
  });

  const episodeUrls = episodeHrefs.map((href) => resolveUrl(href, archiveUrl));

  if (!episodeUrls.length) {
    throw new Error("Episode links not found on recent episodes page.");
  }

  return episodeUrls;
}

async function loadFirstAvailableBoard(page, episodeUrls) {
  for (const episodeUrl of episodeUrls) {
    await page.goto(episodeUrl, { waitUntil: "domcontentloaded" });

    const hasRoundTable = await page.evaluate(() => Boolean(document.querySelector("table.round")));
    if (!hasRoundTable) {
      console.warn("Episode has no first round table; trying previous episode: " + episodeUrl);
      continue;
    }

    const board = await page.evaluate(parseEpisodeInPage, episodeUrl);
    return finalizeBoard(board);
  }

  throw new Error("No archived episode with a first round table was found.");
}

function resolveUrl(value, baseUrl) {
  if (!value) {
    throw new Error("Cannot resolve empty URL.");
  }

  return new URL(value, baseUrl).href;
}

async function writeJson(outputPath, payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
