#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

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

    return page.evaluate(parseEpisodeInPage, episodeUrl);
  }

  throw new Error("No archived episode with a first round table was found.");
}

function parseEpisodeInPage(episodeUrl) {
  const round = document.querySelector("table.round");

  if (!round) {
    throw new Error("First round table not found.");
  }

  const rows = Array.from(round.querySelectorAll(":scope > tbody > tr, :scope > tr"));
  const categoryCells = rows[0] ? Array.from(rows[0].querySelectorAll("td.category")) : [];
  const categories = categoryCells.map((cell, index) => ({
    id: "category-" + index,
    title: cleanText(cell.querySelector(".category_name") || cell) || "Category"
  }));

  if (!categories.length) {
    throw new Error("No categories found in first round.");
  }

  const clues = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const clueCells = Array.from(row.querySelectorAll(":scope > td.clue"));
    categories.forEach((category, categoryIndex) => {
      const cell = clueCells[categoryIndex];
      clues.push(parseClueCell(cell, category.id, rowIndex, categoryIndex));
    });
  });

  return {
    episodeUrl,
    episodeTitle: getEpisodeTitle(),
    categories,
    clues
  };

  function parseClueCell(cell, categoryId, rowIndex, categoryIndex) {
    const id = categoryId + "-row-" + rowIndex;

    if (!cell) {
      return unavailableClue(id, categoryId, rowIndex, categoryIndex);
    }

    if (cell.querySelector("img, audio, video, object, embed")) {
      return unavailableClue(id, categoryId, rowIndex, categoryIndex);
    }

    const value = cleanText(cell.querySelector(".clue_value"));
    const clueText = cleanText(cell.querySelector(".clue_text"));
    const response = cleanText(cell.querySelector("em.correct_response"));

    if (!value || !clueText || !response) {
      return unavailableClue(id, categoryId, rowIndex, categoryIndex);
    }

    return {
      id,
      categoryId,
      rowIndex,
      categoryIndex,
      value,
      numericValue: parseDollarValue(value),
      clueText,
      response,
      status: "available",
      outcome: null
    };
  }

  function unavailableClue(id, categoryId, rowIndex, categoryIndex) {
    return {
      id,
      categoryId,
      rowIndex,
      categoryIndex,
      value: "N/A",
      numericValue: 0,
      clueText: "",
      response: "",
      status: "unavailable",
      outcome: null
    };
  }

  function getEpisodeTitle() {
    const titleCandidates = [
      document.querySelector("#game_title"),
      document.querySelector("#content h1"),
      document.querySelector("title")
    ];

    for (const candidate of titleCandidates) {
      const text = cleanText(candidate);
      if (text) {
        return text.replace(/\s*-\s*J! Archive\s*$/i, "");
      }
    }

    return "";
  }

  function cleanText(node) {
    if (!node) {
      return "";
    }

    return node.textContent.replace(/\s+/g, " ").trim();
  }

  function parseDollarValue(value) {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
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
