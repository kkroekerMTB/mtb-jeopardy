#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const { parseEpisodeInPage, finalizeBoard, deterministicHash } = require("./game-data");

const J_ARCHIVE_HOME_URL = process.env.J_ARCHIVE_HOME_URL || "https://www.j-archive.com/";
const SCORES_API_URL = process.env.SCORES_API_URL ||
  "https://app-mtb-jeopardy-ftdbbcefh2dqd9d0.canadaeast-01.azurewebsites.net/api/source-episodes";
const CURRENT_GAME_DATA_URL = process.env.CURRENT_GAME_DATA_URL || "";
const OUTPUT_PATH = process.env.JEOPARDY_DATA_PATH || path.join("data", "latest-game.json");
const GAME_TIME_ZONE = "America/New_York";
const FALLBACK_SEASONS = Array.from({ length: 40 }, (_, index) => index + 1);
const SEASON_URL_TEMPLATE = "https://www.j-archive.com/showseason.php?season={season}";
const MAX_FALLBACK_ATTEMPTS = 25;

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

async function refreshGameData(options) {
  const day = getGameDay(options.now);
  const publishedBoard = await fetchPublishedBoard(
    options.fetchImpl,
    options.currentGameDataUrl,
    day.selectionDate
  );

  if (publishedBoard) {
    console.log("Reusing game data already selected for " + day.selectionDate + ".");
    return publishedBoard;
  }

  const usedEpisodes = await fetchUsedEpisodes(options.fetchImpl, options.scoresApiUrl, day.cutoff);
  let recentBoard = null;

  try {
    const episodeCandidates = await findEpisodeCandidates(options.page, options.jArchiveHomeUrl);
    recentBoard = await loadFirstAvailableBoard(options.page, episodeCandidates);
  } catch (error) {
    console.warn("Could not load a recent episode; selecting a fallback: " + errorMessage(error));
  }

  if (recentBoard && !isUsedEpisode(recentBoard.episodeTitle, usedEpisodes)) {
    recentBoard.selectionDate = day.selectionDate;
    recentBoard.selectionMode = "latest";
    console.log("Selected latest episode " + recentBoard.episodeTitle + ".");
    return recentBoard;
  }

  if (recentBoard) {
    console.warn("Newest playable episode was already used: " + recentBoard.episodeTitle);
  }

  return selectFallbackBoard({
    page: options.page,
    usedEpisodes,
    selectionDate: day.selectionDate,
    fallbackSeasons: options.fallbackSeasons || FALLBACK_SEASONS,
    seasonUrlTemplate: options.seasonUrlTemplate || SEASON_URL_TEMPLATE,
    maxFallbackAttempts: options.maxFallbackAttempts ?? MAX_FALLBACK_ATTEMPTS
  });
}

async function fetchPublishedBoard(fetchImpl, currentGameDataUrl, selectionDate) {
  if (!currentGameDataUrl) {
    return null;
  }

  const url = new URL(currentGameDataUrl);
  url.searchParams.set("selection-date", selectionDate);
  const response = await fetchImpl(url.href, { cache: "no-store" });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Published game lookup failed with status " + response.status + ".");
  }

  let board;
  try {
    board = await response.json();
  } catch (error) {
    throw new Error("Published game lookup returned malformed JSON.", { cause: error });
  }

  if (!isBoardPayload(board)) {
    throw new Error("Published game lookup returned malformed game data.");
  }

  if (board.selectionDate === undefined) {
    return null;
  }

  if (typeof board.selectionDate !== "string") {
    throw new Error("Published game lookup returned an invalid selection date.");
  }

  return board.selectionDate === selectionDate ? board : null;
}

function isBoardPayload(board) {
  return Boolean(board) &&
    typeof board === "object" &&
    typeof board.episodeUrl === "string" &&
    Array.isArray(board.categories) &&
    board.categories.length > 0 &&
    Array.isArray(board.clues) &&
    board.clues.length > 0;
}

async function fetchUsedEpisodes(fetchImpl, scoresApiUrl, cutoff) {
  const url = new URL(scoresApiUrl);
  url.searchParams.set("before", cutoff.toISOString());
  const response = await fetchImpl(url.href);

  if (!response.ok) {
    throw new Error("Used episode lookup failed with status " + response.status + ".");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Used episode lookup returned malformed JSON.", { cause: error });
  }

  if (!payload || !Array.isArray(payload.sourceEpisodes) ||
      payload.sourceEpisodes.some((title) => typeof title !== "string")) {
    throw new Error("Used episode lookup returned malformed data.");
  }

  return {
    showNumbers: new Set(payload.sourceEpisodes.map(extractShowNumber).filter(Boolean)),
    titles: new Set(payload.sourceEpisodes.map((title) => title.trim()).filter(Boolean))
  };
}

function getGameDay(now) {
  const parts = getZonedParts(now, GAME_TIME_ZONE);
  const selectionDate = [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
  const targetMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  let cutoffTime = targetMidnight;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = getZonedParts(new Date(cutoffTime), GAME_TIME_ZONE, true);
    const representedTime = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    cutoffTime += targetMidnight - representedTime;
  }

  return {
    selectionDate,
    cutoff: new Date(cutoffTime)
  };
}

function getZonedParts(date, timeZone, includeTime = false) {
  const options = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  };

  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.second = "2-digit";
    options.hourCycle = "h23";
  }

  const values = {};
  for (const part of new Intl.DateTimeFormat("en-CA", options).formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return values;
}

async function findEpisodeCandidates(page, jArchiveHomeUrl) {
  await navigate(page, jArchiveHomeUrl);

  const archiveHref = await page.evaluate(() => {
    const recentLink = document.querySelector("body > table > tbody > tr > td > p:nth-child(3) > a:last-child");
    return recentLink ? recentLink.getAttribute("href") : "";
  });

  if (!archiveHref) {
    throw new Error("Recent episodes link not found on J-Archive home page.");
  }

  const archiveUrl = resolveUrl(archiveHref, jArchiveHomeUrl);
  await navigate(page, archiveUrl);

  const episodeLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("#content > table > tbody > tr > td:first-child > a"))
      .map((link) => ({
        href: link.getAttribute("href"),
        text: link.textContent.trim()
      }))
      .filter((link) => link.href);
  });

  const candidates = episodeLinks.map((link) => episodeCandidate(link, archiveUrl));

  if (!candidates.length) {
    throw new Error("Episode links not found on recent episodes page.");
  }

  return candidates;
}

async function loadFirstAvailableBoard(page, episodeCandidates) {
  for (const candidate of episodeCandidates) {
    try {
      const board = await loadBoard(page, candidate);
      if (board) {
        return board;
      }
      console.warn("Recent episode has no playable first round: " + candidate.url);
    } catch (error) {
      console.warn(
        "Could not load recent episode; trying previous episode: " +
        candidate.url + " (" + errorMessage(error) + ")"
      );
    }
  }

  throw new Error("No archived episode with a first round table was found.");
}

async function selectFallbackBoard(options) {
  const { candidates, loadedSeasonCount } = await findFallbackCandidates(
    options.page,
    options.fallbackSeasons,
    options.seasonUrlTemplate
  );

  if (!loadedSeasonCount) {
    throw new Error("No fallback season index could be loaded.");
  }

  const unusedCandidates = candidates.filter((candidate) =>
    candidate.showNumber && !options.usedEpisodes.showNumbers.has(candidate.showNumber)
  );

  if (!unusedCandidates.length) {
    throw new Error("No unused fallback episodes remain.");
  }

  const orderedCandidates = seededShuffle(unusedCandidates, options.selectionDate);
  const candidatesToTry = orderedCandidates.slice(0, options.maxFallbackAttempts);

  for (const candidate of candidatesToTry) {
    try {
      const board = await loadBoard(options.page, candidate);
      if (!board) {
        console.warn("Fallback episode has no playable first round: " + candidate.url);
        continue;
      }

      if (isUsedEpisode(board.episodeTitle, options.usedEpisodes)) {
        console.warn("Fallback episode was already used: " + board.episodeTitle);
        continue;
      }

      board.selectionDate = options.selectionDate;
      board.selectionMode = "fallback";
      console.log("Selected fallback episode " + board.episodeTitle + ".");
      return board;
    } catch (error) {
      console.warn(
        "Could not use fallback episode: " +
        candidate.url + " (" + errorMessage(error) + ")"
      );
    }
  }

  throw new Error(
    "No playable fallback episode was found after " + candidatesToTry.length + " attempts."
  );
}

async function findFallbackCandidates(page, seasons, seasonUrlTemplate) {
  const candidatesByShow = new Map();
  let loadedSeasonCount = 0;

  for (const season of seasons) {
    const seasonUrl = seasonUrlTemplate.replace("{season}", String(season));
    let links = null;
    let lastError = null;

    for (let attempt = 0; attempt < 2 && !links; attempt += 1) {
      try {
        await navigate(page, seasonUrl);
        links = await episodeLinksInPage(page);
      } catch (error) {
        lastError = error;
      }
    }

    if (!links) {
      console.warn(
        "Skipping unavailable fallback season " +
        season + " (" + errorMessage(lastError) + ")"
      );
      continue;
    }

    loadedSeasonCount += 1;
    for (const link of links) {
      const candidate = episodeCandidate(link, seasonUrl);
      if (candidate.showNumber) {
        candidatesByShow.set(candidate.showNumber, candidate);
      }
    }
  }

  return {
    candidates: Array.from(candidatesByShow.values()),
    loadedSeasonCount
  };
}

async function episodeLinksInPage(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href*='showgame.php?game_id=']"))
      .map((link) => ({
        href: link.getAttribute("href"),
        text: link.textContent.trim()
      }))
      .filter((link) => link.href);
  });
}

async function loadBoard(page, candidate) {
  await navigate(page, candidate.url);

  const hasRoundTable = await page.evaluate(() => Boolean(document.querySelector("table.round")));
  if (!hasRoundTable) {
    return null;
  }

  const board = await page.evaluate(parseEpisodeInPage, candidate.url);
  ensureEpisodeTitle(board, candidate);
  if (!extractShowNumber(board.episodeTitle)) {
    throw new Error("Episode has no stable show number.");
  }

  return finalizeBoard(board);
}

async function navigate(page, url) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 15000
  });
  if (response && !response.ok()) {
    throw new Error("Navigation failed with status " + response.status() + ": " + url);
  }
}

function seededShuffle(candidates, seed) {
  const shuffled = candidates.slice().sort((left, right) =>
    left.showNumber.localeCompare(right.showNumber) || left.url.localeCompare(right.url)
  );
  let state = deterministicHash(seed) || 0x9e3779b9;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const selectedIndex = state % (index + 1);
    [shuffled[index], shuffled[selectedIndex]] = [shuffled[selectedIndex], shuffled[index]];
  }

  return shuffled;
}

function episodeCandidate(link, baseUrl) {
  return {
    url: resolveUrl(link.href, baseUrl),
    showNumber: extractShowNumber(link.text),
    airedDate: (link.text.match(/\baired\s+(\d{4}-\d{2}-\d{2})\b/i) || [])[1] || ""
  };
}

function ensureEpisodeTitle(board, candidate) {
  if (extractShowNumber(board.episodeTitle) || !candidate.showNumber) {
    return;
  }

  board.episodeTitle = synthesizeEpisodeTitle(candidate);
}

function synthesizeEpisodeTitle(candidate) {
  if (!candidate.airedDate) {
    return "Show #" + candidate.showNumber;
  }

  const airedDate = new Date(candidate.airedDate + "T12:00:00.000Z");
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(airedDate);
  return "Show #" + candidate.showNumber + " - " + formattedDate;
}

function isUsedEpisode(title, usedEpisodes) {
  const showNumber = extractShowNumber(title);
  return (showNumber && usedEpisodes.showNumbers.has(showNumber)) ||
    usedEpisodes.titles.has(String(title || "").trim());
}

function extractShowNumber(value) {
  const match = String(value || "").match(/#(\d+)/);
  return match ? match[1] : "";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  refreshGameData
};
