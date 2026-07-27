const { test, expect } = require("@playwright/test");
const { parseEpisodeInPage, finalizeBoard } = require("../scripts/game-data");

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
