const { test, expect } = require("@playwright/test");
const { parseEpisodeInPage, finalizeBoard } = require("../scripts/game-data");

test("parses normalized category comments separately from category titles", async ({ page }) => {
  await page.setContent(`
    <table class="round">
      <tr>
        <td class="category">
          <table><tr><td class="category_name">SPELL THAT NAME</td></tr>
          <tr><td class="category_comments">(Alex: The dreaded spelling category!)</td></tr></table>
        </td>
        <td class="category"><div class="category_name">NO COMMENT</div></td>
      </tr>
      <tr>
        <td class="clue"><table><tr><td class="clue_value">$200</td></tr>
          <tr><td class="clue_text">First clue</td></tr></table>
          <em class="correct_response">first response</em></td>
        <td class="clue"><table><tr><td class="clue_value">$200</td></tr>
          <tr><td class="clue_text">Second clue</td></tr></table>
          <em class="correct_response">second response</em></td>
      </tr>
    </table>
  `);

  const board = await page.evaluate(parseEpisodeInPage, "https://example.test/showgame.php?game_id=9999");

  expect(board.categories).toEqual([
    {
      id: "category-0",
      title: "SPELL THAT NAME",
      comment: "(Alex: The dreaded spelling category!)"
    },
    { id: "category-1", title: "NO COMMENT", comment: "" }
  ]);
});

test("parses a source Daily Double without treating its missing assigned value as unavailable", async ({ page }) => {
  await page.setContent(`
    <div id="game_title">Show #9999</div>
    <table class="round">
      <tr>
        <td class="category"><div class="category_name">FIRST</div></td>
        <td class="category"><div class="category_name">SECOND</div></td>
      </tr>
      <tr>
        <td class="clue">
          <table><tr><td class="clue_value">$200</td></tr>
          <tr><td class="clue_text">Ordinary clue</td></tr></table>
          <em class="correct_response">ordinary response</em>
        </td>
        <td class="clue">
          <table><tr><td class="clue_value_daily_double">DD: $1,000</td></tr>
          <tr><td class="clue_text">Source Daily Double clue</td></tr></table>
          <em class="correct_response">special response</em>
        </td>
      </tr>
    </table>
  `);

  const parsed = await page.evaluate(parseEpisodeInPage, "https://example.test/showgame.php?game_id=9999");
  const board = finalizeBoard(parsed);

  expect(board.dailyDoubleClueId).toBe("category-1-row-0");
  expect(board.clues[1]).toMatchObject({
    id: "category-1-row-0",
    value: "$200",
    numericValue: 0,
    status: "available"
  });
});

test("chooses the same playable fallback when source Daily Double metadata is unusable", () => {
  const board = {
    episodeUrl: "https://example.test/showgame.php?game_id=9999",
    categories: [{ id: "category-0", title: "FIRST" }],
    clues: [
      clue("category-0-row-0", 0, "unavailable", true),
      clue("category-0-row-1", 1, "available", false),
      clue("category-0-row-2", 2, "available", false),
      clue("category-0-row-3", 3, "available", false)
    ]
  };

  const first = finalizeBoard(structuredClone(board));
  const second = finalizeBoard(structuredClone(board));

  expect(first.dailyDoubleClueId).toBe(second.dailyDoubleClueId);
  expect(first.dailyDoubleClueId).not.toBe("category-0-row-0");
  expect(first.clues.find((item) => item.id === first.dailyDoubleClueId).status).toBe("available");
  expect(first.clues.find((item) => item.id === first.dailyDoubleClueId).numericValue).toBe(0);
  expect(first.clues[0].status).toBe("unavailable");
});

test("does not invent a row-position value when the source Daily Double has no row peer", () => {
  const sourceDailyDouble = clue("category-0-row-0", 0, "available", true);
  sourceDailyDouble.value = "";
  sourceDailyDouble.numericValue = 0;
  const board = {
    episodeUrl: "https://example.test/showgame.php?game_id=9999",
    categories: [{ id: "category-0", title: "FIRST" }],
    clues: [
      sourceDailyDouble,
      clue("category-0-row-1", 1, "available", false)
    ]
  };

  const finalized = finalizeBoard(board);

  expect(finalized.dailyDoubleClueId).toBe("category-0-row-1");
  expect(finalized.clues[0]).toMatchObject({
    value: "N/A",
    numericValue: 0,
    status: "unavailable"
  });
});

test("restores normal scoring values to ambiguous source markers that are not selected", () => {
  const firstMarker = clue("category-0-row-0", 0, "available", true);
  const secondMarker = {
    ...clue("category-1-row-0", 0, "available", true),
    categoryId: "category-1",
    categoryIndex: 1
  };
  const rowPeer = {
    ...clue("category-2-row-0", 0, "available", false),
    categoryId: "category-2",
    categoryIndex: 2
  };
  firstMarker.value = "";
  firstMarker.numericValue = 0;
  secondMarker.value = "";
  secondMarker.numericValue = 0;
  rowPeer.value = "$200";
  rowPeer.numericValue = 200;
  const board = {
    episodeUrl: "https://example.test/showgame.php?game_id=9999",
    categories: [
      { id: "category-0", title: "FIRST" },
      { id: "category-1", title: "SECOND" },
      { id: "category-2", title: "THIRD" }
    ],
    clues: [
      firstMarker,
      secondMarker,
      rowPeer,
      clue("category-0-row-1", 1, "available", false)
    ]
  };

  const finalized = finalizeBoard(board);
  const ambiguousMarkers = finalized.clues.filter((item) => item.sourceDailyDouble);

  expect(ambiguousMarkers).toHaveLength(2);
  expect(ambiguousMarkers.map((item) => item.numericValue)).toEqual([200, 200]);
  expect(ambiguousMarkers.map((item) => item.value)).toEqual(["$200", "$200"]);
  expect(ambiguousMarkers.map((item) => item.id)).not.toContain(finalized.dailyDoubleClueId);
});

function clue(id, rowIndex, status, sourceDailyDouble) {
  return {
    id,
    categoryId: "category-0",
    rowIndex,
    categoryIndex: 0,
    value: status === "available" ? `$${(rowIndex + 1) * 200}` : "N/A",
    numericValue: status === "available" ? (rowIndex + 1) * 200 : 0,
    clueText: status === "available" ? "Playable clue" : "",
    response: status === "available" ? "response" : "",
    status,
    outcome: null,
    sourceDailyDouble
  };
}
