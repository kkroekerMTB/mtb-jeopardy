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
    const sourceDailyDouble = Boolean(cell && cell.querySelector(".clue_value_daily_double"));

    if (!cell) {
      return unavailableClue(id, categoryId, rowIndex, categoryIndex, sourceDailyDouble);
    }

    if (cell.querySelector("img, audio, video, object, embed")) {
      return unavailableClue(id, categoryId, rowIndex, categoryIndex, sourceDailyDouble);
    }

    const value = cleanText(cell.querySelector(".clue_value"));
    const clueText = cleanText(cell.querySelector(".clue_text"));
    const response = cleanText(cell.querySelector("em.correct_response"));

    if ((!value && !sourceDailyDouble) || !clueText || !response) {
      return unavailableClue(id, categoryId, rowIndex, categoryIndex, sourceDailyDouble);
    }

    return {
      id,
      categoryId,
      rowIndex,
      categoryIndex,
      value,
      numericValue: sourceDailyDouble ? 0 : parseDollarValue(value),
      clueText,
      response,
      status: "available",
      outcome: null,
      sourceDailyDouble
    };
  }

  function unavailableClue(id, categoryId, rowIndex, categoryIndex, sourceDailyDouble) {
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
      outcome: null,
      sourceDailyDouble
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

function finalizeBoard(board) {
  const sourceCandidates = board.clues.filter((clue) => clue.sourceDailyDouble);
  const playableSource = sourceCandidates.length === 1 && sourceCandidates[0].status === "available"
    ? sourceCandidates[0]
    : null;

  normalizeSourceDailyDoubleDisplayValues(board);

  if (playableSource) {
    board.dailyDoubleClueId = playableSource.id;
    board.dailyDoubleSelection = "source";
    playableSource.numericValue = 0;
    return board;
  }

  let eligibleClues = board.clues.filter((clue) =>
    clue.status === "available" && !clue.sourceDailyDouble
  );

  if (!eligibleClues.length) {
    eligibleClues = board.clues.filter((clue) => clue.status === "available");
  }

  if (!eligibleClues.length) {
    throw new Error("Game data has no playable clue for the Daily Double.");
  }

  eligibleClues.sort((left, right) => left.id.localeCompare(right.id));
  const seed = board.episodeUrl + "|" + eligibleClues.map((clue) => clue.id).join("|");
  const selectedIndex = deterministicHash(seed) % eligibleClues.length;
  const selectedClue = eligibleClues[selectedIndex];
  board.dailyDoubleClueId = selectedClue.id;
  board.dailyDoubleSelection = "fallback";
  selectedClue.numericValue = 0;
  return board;
}

function normalizeSourceDailyDoubleDisplayValues(board) {
  for (const clue of board.clues) {
    if (!clue.sourceDailyDouble || clue.status !== "available" || clue.value) {
      continue;
    }

    const rowPeer = board.clues.find((candidate) =>
      candidate.rowIndex === clue.rowIndex &&
      candidate.id !== clue.id &&
      candidate.status === "available" &&
      candidate.value &&
      candidate.value !== "N/A"
    );
    clue.value = rowPeer ? rowPeer.value : "$" + ((clue.rowIndex + 1) * 200);
  }
}

function deterministicHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

module.exports = {
  parseEpisodeInPage,
  finalizeBoard
};
