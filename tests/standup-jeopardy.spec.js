const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const appUrl = "http://127.0.0.1:4173/index.html";
const proxyPrefix = "https://api.codetabs.com/v1/proxy/?quest=";
const homeUrl = "https://www.j-archive.com/";
const seasonUrl = "https://www.j-archive.com/showseason.php?season=42";
const latestGameUrl = "https://www.j-archive.com/showgame.php?game_id=9999";
const previousGameUrl = "https://www.j-archive.com/showgame.php?game_id=9998";

test.describe("Standup Jeopardy", () => {
  test.beforeEach(async ({ page }) => {
    await routeJArchive(page);
  });

  test("fetches the latest episode, renders only the first round, and shows metadata", async ({ page }) => {
    await page.goto(appUrl);

    await expect(page.getByRole("heading", { name: "Standup Jeopardy" })).toBeVisible();
    await expect(page.getByText("Show #9999 - Monday, June 1, 2026")).toBeVisible();
    await expect(page.getByRole("link", { name: "Source episode" })).toHaveAttribute("href", latestGameUrl);
    await expect(page.getByText("Double Round Category")).toHaveCount(0);

    await expect(page.getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.getByText("WORDPLAY")).toBeVisible();
    await expect(page.locator(".category")).toHaveCount(6);
    await expect(page.locator(".tile")).toHaveCount(30);
    await expect(page.locator(".tile.unavailable")).toHaveCount(7);
    await expect(page.locator("#unavailableCount")).toHaveText("7");
    await expect(page.locator(".tile").first()).toHaveCSS("background-color", "rgb(7, 31, 143)");
    await expect(page.locator(".tile").first()).toHaveCSS("color", "rgb(242, 201, 76)");
    await expect(page.getByRole("button", { name: "$1,234" })).toBeVisible();
  });

  test("shows a loading state while fetching and then hides it after the board renders", async ({ page }) => {
    await routeJArchive(page, { delayHomeMs: 500 });

    await page.goto(appUrl);

    await expect(page.getByText("Finding latest game...")).toBeVisible();
    await expect(page.locator(".loader")).toBeVisible();
    await expect(page.getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.locator("#status")).toBeHidden();
  });

  test("falls back to the previous episode when the latest episode has no round table", async ({ page }) => {
    await routeJArchive(page, { latestEpisodeMissingRound: true });

    await page.goto(appUrl);

    await expect(page.getByText("Show #9998 - Friday, May 29, 2026")).toBeVisible();
    await expect(page.getByRole("link", { name: "Source episode" })).toHaveAttribute("href", previousGameUrl);
    await expect(page.getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.locator(".tile")).toHaveCount(30);
  });

  test("normalizes scraped content to plain text and reveals exact responses", async ({ page }) => {
    await page.goto(appUrl);

    await page.getByRole("button", { name: "$200" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("A mass of cytoplasm bound by a membrane")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(0);
    await expect(page.getByText("a cell")).toBeHidden();

    await page.locator("#clueCard").click();

    await expect(page.getByText("a cell")).toBeVisible();
    await expect(page.locator("#overlayResponse")).toHaveCSS("opacity", "1");
  });

  test("animates opening from the clicked tile and closing back toward it", async ({ page }) => {
    await page.goto(appUrl);

    const firstTile = page.getByRole("button", { name: "$200" }).first();
    await firstTile.click();

    await expect(page.locator("#overlay")).toHaveClass(/animating/);
    await expect.poll(async () => page.locator("#clueCard").evaluate((el) => el.style.transform)).toContain("scale");
    await expect(page.locator("#overlay")).not.toHaveClass(/animating/);

    await page.locator("#closeClue").click();

    await expect(page.locator("#overlay")).toHaveClass(/closing/);
    await expect.poll(async () => page.locator("#overlay").evaluate((el) => el.hidden)).toBe(true);
    await expect(page.locator("#correctCount")).toHaveText("0");
    await expect(firstTile).toBeEnabled();
  });

  test("tracks correct answers, net value, used tile state, and prevents reopening", async ({ page }) => {
    await page.goto(appUrl);

    const firstTile = page.getByRole("button", { name: "$200" }).first();
    await firstTile.click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Correct" }).click();

    await expect(page.locator("#correctCount")).toHaveText("1");
    await expect(page.locator("#missedCount")).toHaveText("0");
    await expect(page.locator("#netValue")).toHaveText("$200");
    await expect(firstTile).toBeDisabled();
    await expect(firstTile).toHaveClass(/used/);

    await firstTile.click({ force: true });
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("tracks missed answers as negative net value", async ({ page }) => {
    await page.goto(appUrl);

    await page.getByRole("button", { name: "$400" }).first().click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Missed" }).click();

    await expect(page.locator("#correctCount")).toHaveText("0");
    await expect(page.locator("#missedCount")).toHaveText("1");
    await expect(page.locator("#netValue")).toHaveText("-$400");
  });

  test("scores Daily Doubles like normal clues", async ({ page }) => {
    await page.goto(appUrl);

    await page.getByRole("button", { name: "$200" }).nth(2).click();
    await page.locator("#clueCard").click();
    await expect(page.getByText("normal scoring")).toBeVisible();
    await page.getByRole("button", { name: "Correct" }).click();

    await expect(page.locator("#correctCount")).toHaveText("1");
    await expect(page.locator("#netValue")).toHaveText("$200");
  });

  test("closes before reveal without marking the tile used", async ({ page }) => {
    await page.goto(appUrl);

    const tile = page.getByRole("button", { name: "$600" }).first();
    await tile.click();
    await page.locator("#closeClue").click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("#correctCount")).toHaveText("0");
    await expect(page.locator("#missedCount")).toHaveText("0");
    await expect(tile).toBeEnabled();
    await expect(tile).not.toHaveClass(/used/);
  });

  test("disables malformed, missing, and media clues without adding them to scoring", async ({ page }) => {
    await page.goto(appUrl);

    await expect(page.locator(".tile.unavailable")).toHaveCount(7);
    await expect(page.locator(".tile.unavailable")).toHaveText(["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]);
    await expect(page.locator("#unavailableCount")).toHaveText("7");
    await expect(page.locator("#correctCount")).toHaveText("0");
    await expect(page.locator("#missedCount")).toHaveText("0");
    await expect(page.locator("#netValue")).toHaveText("$0");

    await page.locator(".tile.unavailable").first().click({ force: true });
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("preserves category shape even when an entire category is unavailable", async ({ page }) => {
    await page.goto(appUrl);

    const allMediaColumnTiles = page.locator(".board .tile:nth-child(6n)");

    await expect(page.getByText("ALL MEDIA")).toBeVisible();
    await expect(allMediaColumnTiles).toHaveCount(5);
    await expect(allMediaColumnTiles).toHaveText(["N/A", "N/A", "N/A", "N/A", "N/A"]);
  });

  test("does not persist used tile state across refreshes", async ({ page }) => {
    await page.goto(appUrl);

    await page.getByRole("button", { name: "$200" }).first().click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Correct" }).click();
    await expect(page.locator("#correctCount")).toHaveText("1");

    await page.reload();

    await expect(page.getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.locator("#correctCount")).toHaveText("0");
    await expect(page.locator("#netValue")).toHaveText("$0");
    await expect(page.getByRole("button", { name: "$200" }).first()).toBeEnabled();
  });

  test("surfaces a visible load failure and logs details when the latest game cannot be found", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await routeJArchive(page, { brokenSeason: true });

    await page.goto(appUrl);

    await expect(page.getByText("Couldn't load latest game")).toBeVisible();
    await expect.poll(() => errors.some((message) => message.includes("Couldn't load latest game"))).toBe(true);
  });

  test("keeps MVP scope controls out of the UI", async ({ page }) => {
    await page.goto(appUrl);

    await expect(page.getByRole("button", { name: /new game|reload latest/i })).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /correct|missed/i })).toHaveCount(0);
  });
});

test("static file stays self-contained and dependency-free", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  expect(html).not.toMatch(/<script\s+[^>]*src=/i);
  expect(html).not.toMatch(/<link\s+[^>]*rel=["']?stylesheet/i);
  expect(html).not.toMatch(/<img\b/i);
  expect(html).not.toContain("sample");
  expect(html).toContain('const CORS_PROXY_URL = "https://api.codetabs.com/v1/proxy/?quest=";');
});

async function routeJArchive(page, options = {}) {
  await page.route(proxyPrefix + "**", async (route) => {
    const requestUrl = route.request().url();
    const targetUrl = requestUrl.slice(proxyPrefix.length);

    if (targetUrl === homeUrl) {
      if (options.delayHomeMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayHomeMs));
      }
      await route.fulfill({ status: 200, contentType: "text/html", body: homeHtml() });
      return;
    }

    if (targetUrl === seasonUrl) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: options.brokenSeason ? brokenSeasonHtml() : seasonHtml()
      });
      return;
    }

    if (targetUrl === latestGameUrl) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: options.latestEpisodeMissingRound ? partialEpisodeHtml() : episodeHtml()
      });
      return;
    }

    if (targetUrl === previousGameUrl) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: episodeHtml("9998", "Friday, May 29, 2026")
      });
      return;
    }

    await route.abort();
  });
}

function homeHtml() {
  return `
    <!doctype html>
    <html>
      <body>
        <table><tbody><tr><td>
          <p><a href="showseason.php?season=1">Old season</a></p>
          <p>Other links</p>
          <p><a href="listseasons.php">All</a> <a href="showseason.php?season=42">Season 42</a></p>
        </td></tr></tbody></table>
      </body>
    </html>
  `;
}

function seasonHtml() {
  return `
    <!doctype html>
    <html>
      <body>
        <div id="content">
          <table><tbody>
            <tr><td><a href="showgame.php?game_id=9999">Show #9999 - Monday, June 1, 2026</a></td></tr>
            <tr><td><a href="showgame.php?game_id=9998">Show #9998 - Friday, May 29, 2026</a></td></tr>
          </tbody></table>
        </div>
      </body>
    </html>
  `;
}

function brokenSeasonHtml() {
  return `
    <!doctype html>
    <html><body><div id="content"><p>No games here.</p></div></body></html>
  `;
}

function partialEpisodeHtml() {
  return `
    <!doctype html>
    <html>
      <head><title>Show #9999 - Monday, June 1, 2026 - J! Archive</title></head>
      <body>
        <div id="game_title">Show #9999 - Monday, June 1, 2026</div>
        <div id="contestants">Contestants are listed before clues are archived.</div>
      </body>
    </html>
  `;
}

function episodeHtml(showNumber = "9999", date = "Monday, June 1, 2026") {
  return `
    <!doctype html>
    <html>
      <head><title>Show #${showNumber} - ${date} - J! Archive</title></head>
      <body>
        <div id="game_title">Show #${showNumber} - ${date}</div>
        <table class="round"><tbody>
          <tr>
            <td class="category"><table><tr><td class="category_name"> Science &amp; <i>Nature</i> </td></tr></table></td>
            <td class="category"><table><tr><td class="category_name">Word<br>Play</td></tr></table></td>
            <td class="category"><table><tr><td class="category_name">Daily Double-ish</td></tr></table></td>
            <td class="category"><table><tr><td class="category_name">Malformed</td></tr></table></td>
            <td class="category"><table><tr><td class="category_name">Missing</td></tr></table></td>
            <td class="category"><table><tr><td class="category_name">All Media</td></tr></table></td>
          </tr>
          ${roundRow(200, [
    clue("$200", " A mass of cytoplasm bound by a membrane, <a href='https://example.test'>it's</a> the smallest independently functioning unit of living matter ", "a cell"),
    clue("$200", "This clue has <em>formatting</em> and extra     spacing", "kept exactly"),
    clue("$200", "This clue is tagged as a Daily Double but plays normally", "normal scoring"),
    clue("$200", "Playable malformed-category clue", "fine"),
    clue("$200", "Playable missing-category clue", "fine"),
    mediaClue("$200", "Look at this image")
  ])}
          ${roundRow(400, [
    clue("$400", "Science clue 400", "science 400"),
    clue("$400", "Word clue 400", "word 400"),
    clue("$400", "Daily clue 400", "daily 400"),
    malformedClue("$400", "No response here"),
    missingValueClue("No value here", "missing value"),
    mediaClue("$400", "Listen to this")
  ])}
          ${roundRow(600, [
    clue("$600", "Science clue 600", "science 600"),
    clue("$600", "Word clue 600", "word 600"),
    clue("$600", "Daily clue 600", "daily 600"),
    clue("$600", "Malformed category playable 600", "fine"),
            clue("$600", "Missing category playable 600", "fine"),
    mediaClue("$600", "Watch this")
  ])}
          ${roundRow(800, [
    clue("$800", "Science clue 800", "science 800"),
    clue("$800", "Word clue 800", "word 800"),
    clue("$800", "Daily clue 800", "daily 800"),
    clue("$800", "Malformed category playable 800", "fine"),
    clue("$800", "Missing category playable 800", "fine"),
    mediaClue("$800", "Embedded object")
  ])}
          ${roundRow(1000, [
    clue("$1000", "Science clue 1000", "science 1000"),
            clue("$1,234", "Word clue 1000", "word 1000"),
    clue("$1000", "Daily clue 1000", "daily 1000"),
    clue("$1000", "Malformed category playable 1000", "fine"),
    clue("$1000", "Missing category playable 1000", "fine"),
    mediaClue("$1000", "Embedded video")
  ])}
        </tbody></table>
        <table class="round"><tbody>
          <tr><td class="category"><table><tr><td class="category_name">Double Round Category</td></tr></table></td></tr>
          <tr><td class="clue">${clue("$400", "Double Jeopardy clue", "ignored")}</td></tr>
        </tbody></table>
      </body>
    </html>
  `;
}

function roundRow(value, cells) {
  return `<tr>${cells.map((cell) => cell === "" ? "" : `<td class="clue">${cell}</td>`).join("")}</tr>`;
}

function clue(value, text, response) {
  return `
    <table><tbody><tr>
      <td class="clue_value">${value}</td>
      <td class="clue_text">${text}</td>
      <td><em class="correct_response">${response}</em></td>
    </tr></tbody></table>
  `;
}

function malformedClue(value, text) {
  return `
    <table><tbody><tr>
      <td class="clue_value">${value}</td>
      <td class="clue_text">${text}</td>
    </tr></tbody></table>
  `;
}

function missingValueClue(text, response) {
  return `
    <table><tbody><tr>
      <td class="clue_text">${text}</td>
      <td><em class="correct_response">${response}</em></td>
    </tr></tbody></table>
  `;
}

function mediaClue(value, text) {
  return `
    <table><tbody><tr>
      <td class="clue_value">${value}</td>
      <td class="clue_text">${text}<img src="external.jpg" alt=""></td>
      <td><em class="correct_response">media response</em></td>
    </tr></tbody></table>
  `;
}
