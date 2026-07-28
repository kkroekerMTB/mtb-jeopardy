function createUsedEpisodeIndex(sourceTitles) {
  return {
    showNumbers: new Set(sourceTitles.map(extractShowNumber).filter(Boolean)),
    titles: new Set(sourceTitles.map((title) => title.trim()).filter(Boolean))
  };
}

function episodeCandidate(link, baseUrl) {
  return {
    url: new URL(link.href, baseUrl).href,
    showNumber: extractShowNumber(link.text),
    airedDate: (link.text.match(/\baired\s+(\d{4}-\d{2}-\d{2})\b/i) || [])[1] || ""
  };
}

function identifyBoard(board, candidate) {
  const scrapedTitle = String(board.episodeTitle || "").trim();

  if (!extractShowNumber(scrapedTitle) && candidate.showNumber) {
    board.episodeTitle = synthesizeEpisodeTitle(candidate);
  }

  const showNumber = extractShowNumber(board.episodeTitle);
  if (!showNumber) {
    throw new Error("Episode has no stable show number.");
  }

  return {
    board,
    showNumber,
    titleAliases: new Set([scrapedTitle, board.episodeTitle].filter(Boolean))
  };
}

function isUsedEpisode(identifiedBoard, usedEpisodes) {
  if (usedEpisodes.showNumbers.has(identifiedBoard.showNumber)) {
    return true;
  }

  return Array.from(identifiedBoard.titleAliases).some((title) =>
    usedEpisodes.titles.has(title)
  );
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

function extractShowNumber(value) {
  const match = String(value || "").match(/#(\d+)/);
  return match ? match[1] : "";
}

module.exports = {
  createUsedEpisodeIndex,
  episodeCandidate,
  identifyBoard,
  isUsedEpisode
};
