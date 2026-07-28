const { createUsedEpisodeIndex } = require("./episode-identity");

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

  return createUsedEpisodeIndex(payload.sourceEpisodes);
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

module.exports = {
  fetchPublishedBoard,
  fetchUsedEpisodes
};
