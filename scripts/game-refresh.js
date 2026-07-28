const { parseEpisodeInPage, finalizeBoard, deterministicHash } = require("./game-data");
const { getGameDay } = require("./game-day");
const {
  episodeCandidate,
  identifyBoard,
  isUsedEpisode
} = require("./episode-identity");
const { fetchPublishedBoard, fetchUsedEpisodes } = require("./refresh-clients");

const FALLBACK_SEASONS = Array.from({ length: 40 }, (_, index) => index + 1);
const SEASON_URL_TEMPLATE = "https://www.j-archive.com/showseason.php?season={season}";
const MAX_FALLBACK_ATTEMPTS = 25;

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
  let recentGame = null;

  try {
    const episodeCandidates = await findEpisodeCandidates(options.page, options.jArchiveHomeUrl);
    recentGame = await loadFirstAvailableBoard(options.page, episodeCandidates);
  } catch (error) {
    console.warn("Could not load a recent episode; selecting a fallback: " + errorMessage(error));
  }

  if (recentGame && !isUsedEpisode(recentGame, usedEpisodes)) {
    recentGame.board.selectionDate = day.selectionDate;
    recentGame.board.selectionMode = "latest";
    console.log("Selected latest episode " + recentGame.board.episodeTitle + ".");
    return recentGame.board;
  }

  if (recentGame) {
    console.warn("Newest playable episode was already used: " + recentGame.board.episodeTitle);
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
    const identifiedBoard = await loadBoard(page, candidate);
    if (identifiedBoard) {
      return identifiedBoard;
    }
    console.warn("Recent episode has no playable first round: " + candidate.url);
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
      const identifiedBoard = await loadBoard(options.page, candidate);
      if (!identifiedBoard) {
        console.warn("Fallback episode has no playable first round: " + candidate.url);
        continue;
      }

      if (isUsedEpisode(identifiedBoard, options.usedEpisodes)) {
        console.warn("Fallback episode was already used: " + identifiedBoard.board.episodeTitle);
        continue;
      }

      const board = identifiedBoard.board;
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
  return identifyBoard(finalizeBoard(board), candidate);
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function resolveUrl(value, baseUrl) {
  if (!value) {
    throw new Error("Cannot resolve empty URL.");
  }

  return new URL(value, baseUrl).href;
}

module.exports = {
  refreshGameData
};
