const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const appUrl = "http://127.0.0.1:4173/index.html";
const latestGameUrl = "https://www.j-archive.com/showgame.php?game_id=9999";

test.describe("Standup Jeopardy", () => {
  test.beforeEach(async ({ page }) => {
    await routeGameData(page);
  });

  test("loads generated game data, renders the board, and shows metadata", async ({ page }) => {
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

  test("reports board loading and answered clues without team-identifying data", async ({ page }) => {
    await installTelemetrySpy(page);
    await page.goto(appUrl);

    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "board_loaded",
      properties: {
        episode: "Show #9999 - Monday, June 1, 2026"
      },
      measurements: {
        availableClues: 23,
        unavailableClues: 7
      }
    });

    await page.getByRole("button", { name: "$200" }).first().click();
    await expect(page.locator("#closeClue")).toBeEnabled();
    const correctButton = page.getByRole("button", { name: "Correct" });
    await page.locator("#clueCard").click();
    await expect(correctButton).toBeVisible();
    await correctButton.click();

    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "clue_answered",
      properties: {
        outcome: "correct",
        dailyDouble: "false"
      },
      measurements: {
        scoreDelta: 200,
        answeredClues: 1
      }
    });
    expect(await page.evaluate(() => JSON.stringify(window.telemetryEvents))).not.toContain("teamName");
  });

  test("does not visually reveal the Daily Double tile before it is selected", async ({ page }) => {
    await page.goto(appUrl);

    const ordinaryTile = page.locator(".tile").first();
    const dailyDoubleTile = page.locator(".tile").nth(2);

    await expect(dailyDoubleTile).toHaveText("$200");
    await expect(dailyDoubleTile).toHaveAttribute("class", await ordinaryTile.getAttribute("class"));
    await expect(dailyDoubleTile).toHaveCSS(
      "background-color",
      await ordinaryTile.evaluate((element) => getComputedStyle(element).backgroundColor)
    );
  });

  test("plays the Daily Double sound only when the Daily Double appears", async ({ page }) => {
    await page.addInitScript(() => {
      window.dailyDoublePlayCount = 0;
      HTMLMediaElement.prototype.play = function () {
        if (this.id === "dailyDoubleSound") {
          window.dailyDoublePlayCount += 1;
        }
        return Promise.resolve();
      };
    });
    await page.goto(appUrl);

    const sound = page.locator("#dailyDoubleSound");
    await expect(sound).toHaveAttribute(
      "src",
      "media/jeopardy-daily-double-sound-effect-from-youtube_76mCCAq.mp3"
    );

    await page.locator(".tile").first().click();
    await expect.poll(() => page.evaluate(() => window.dailyDoublePlayCount)).toBe(0);
    await page.locator("#closeClue").click();
    await expect(page.locator("#overlay")).toBeHidden();

    await page.locator(".tile").nth(2).click();
    await expect.poll(() => page.evaluate(() => window.dailyDoublePlayCount)).toBe(1);
  });

  test("plays theme music by default and persists its UI setting", async ({ page }) => {
    await page.addInitScript(() => {
      window.themeMusicEvents = [];
      HTMLMediaElement.prototype.play = function () {
        if (this.id === "themeMusic") {
          window.themeMusicEvents.push("play");
        }
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        if (this.id === "themeMusic") {
          window.themeMusicEvents.push("pause");
        }
      };
    });
    await page.goto(appUrl);

    const setting = page.getByRole("checkbox", { name: "Theme music" });
    await expect(setting).toBeChecked();
    const leaderboardBox = await page.getByRole("button", { name: "Leaderboard" }).boundingBox();
    const musicSettingBox = await setting.locator("..").boundingBox();
    expect(musicSettingBox.y).toBeCloseTo(leaderboardBox.y, 0);
    await expect(page.locator("#themeMusic")).toHaveAttribute("src", "media/Jeopardy-theme-song.mp3");
    await expect.poll(() => page.evaluate(() => window.themeMusicEvents)).toEqual(["play"]);
    await expect.poll(() => page.evaluate(() =>
      localStorage.getItem("standup-jeopardy-theme-music-enabled")
    )).toBe("true");

    await setting.uncheck();
    await expect.poll(() => page.evaluate(() => window.themeMusicEvents)).toEqual(["play", "pause"]);
    await expect.poll(() => page.evaluate(() =>
      localStorage.getItem("standup-jeopardy-theme-music-enabled")
    )).toBe("false");

    await page.reload();
    await expect(setting).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.themeMusicEvents)).toEqual([]);

    await setting.check();
    await expect.poll(() => page.evaluate(() => window.themeMusicEvents)).toEqual(["play"]);
    await expect.poll(() => page.evaluate(() =>
      localStorage.getItem("standup-jeopardy-theme-music-enabled")
    )).toBe("true");
  });

  test("retries default theme music after the browser blocks autoplay", async ({ page }) => {
    await page.addInitScript(() => {
      window.themeMusicPlayCount = 0;
      HTMLMediaElement.prototype.play = function () {
        if (this.id !== "themeMusic") {
          return Promise.resolve();
        }

        window.themeMusicPlayCount += 1;
        return window.themeMusicPlayCount === 1
          ? Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"))
          : Promise.resolve();
      };
    });
    await page.goto(appUrl);

    await expect.poll(() => page.evaluate(() => window.themeMusicPlayCount)).toBe(1);
    await page.getByRole("heading", { name: "Standup Jeopardy" }).click();
    await expect.poll(() => page.evaluate(() => window.themeMusicPlayCount)).toBe(2);
  });

  test("shows a loading state while fetching local data and then hides it after the board renders", async ({ page }) => {
    await routeGameData(page, { delayMs: 500 });

    await page.goto(appUrl);

    await expect(page.getByText("Loading board...")).toBeVisible();
    await expect(page.locator(".loader")).toBeVisible();
    await expect(page.getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.locator("#status")).toBeHidden();
  });

  test("shows the category with a generated plain-text clue and reveals the exact response", async ({ page }) => {
    await page.goto(appUrl);

    await expect(page.getByText("(A note about the science category.)")).toHaveCount(0);
    await page.getByRole("button", { name: "$200" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.getByText("(A note about the science category.)")).toBeVisible();
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
    await expect(page.locator("#closeClue")).toBeDisabled();
    await expect.poll(async () => page.locator("#clueCard").evaluate((el) => el.style.transform)).toContain("scale");
    await expect(page.locator("#overlay")).not.toHaveClass(/animating/);
    await expect(page.locator("#closeClue")).toBeEnabled();

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

  test("requires a wager before revealing the source episode's Daily Double", async ({ page }) => {
    await page.goto(appUrl);

    await page.getByRole("button", { name: "$200" }).nth(2).click();

    await expect(page.getByRole("heading", { name: "Daily Double" })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("DAILY DOUBLE-ISH")).toBeVisible();
    await expect(page.getByText("This clue is the source Daily Double")).toBeHidden();
    await expect(page.getByRole("button", { name: "Close clue" })).toBeHidden();
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toHaveValue("5");
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toHaveAttribute("min", "5");
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toHaveAttribute("max", "1000");
    await expect(page.getByText("Current score: $0")).toBeVisible();
    await expect(page.getByText("Wager $5–$1,000")).toBeVisible();
  });

  test("locks a true Daily Double wager and adds it to the team score", async ({ page }) => {
    await page.goto(appUrl);

    await page.getByRole("button", { name: "$200" }).first().click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Correct" }).click();
    await expect(page.locator("#netValue")).toHaveText("$200");

    const dailyDoubleTile = page.locator(".tile").nth(2);
    await dailyDoubleTile.click();
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toHaveValue("200");

    await page.getByRole("button", { name: "Lock wager" }).click();

    await expect(page.getByText("True Daily Double!")).toBeVisible();
    await expect(page.getByText("Wager: $200")).toBeVisible();
    await expect(page.getByText("This clue is the source Daily Double")).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeHidden();

    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Correct" }).click();

    await expect(page.locator("#correctCount")).toHaveText("2");
    await expect(page.locator("#netValue")).toHaveText("$400");
    await expect(dailyDoubleTile).toBeDisabled();
    await expect(dailyDoubleTile).toHaveCSS("background-color", "rgb(165, 37, 37)");
    await expect(dailyDoubleTile).toContainText("DD +$200");
  });

  test("subtracts a missed Daily Double wager from the team score", async ({ page }) => {
    await page.goto(appUrl);

    const dailyDoubleTile = page.locator(".tile").nth(2);
    await dailyDoubleTile.click();
    await page.getByRole("spinbutton", { name: "Wager" }).fill("750");
    await page.getByRole("button", { name: "Lock wager" }).click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Missed" }).click();

    await expect(page.locator("#correctCount")).toHaveText("0");
    await expect(page.locator("#missedCount")).toHaveText("1");
    await expect(page.locator("#netValue")).toHaveText("-$750");
    await expect(dailyDoubleTile).toContainText("DD -$750");
  });

  test("somersaults the Daily Double forward five times before enabling its wager", async ({ page }) => {
    await page.goto(appUrl);

    await page.locator(".tile").nth(2).click();

    await expect(page.locator("#overlay")).toHaveClass(/daily-double-entering/);
    await expect.poll(async () => page.locator("#clueCard").evaluate((element) => element.style.transform))
      .toContain("rotateX(-1800deg)");
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeHidden();

    await expect(page.locator("#overlay")).not.toHaveClass(/daily-double-entering/, { timeout: 2000 });
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeVisible();
  });

  test("uses a short rotation-free Daily Double entrance when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(appUrl);

    await page.locator(".tile").nth(2).click();

    await expect(page.locator("#overlay")).toHaveClass(/reduced-motion-entering/);
    await expect(page.locator("#clueCard")).not.toHaveAttribute("style", /rotateX/);
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeHidden();
    await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeVisible({ timeout: 1000 });
  });

  test("requires a whole-dollar Daily Double wager within the displayed range", async ({ page }) => {
    await page.goto(appUrl);
    await page.locator(".tile").nth(2).click();

    const wager = page.getByRole("spinbutton", { name: "Wager" });
    await wager.fill("4");
    await page.getByRole("button", { name: "Lock wager" }).click();
    await expect(page.getByText("Enter a whole-dollar wager from $5 to $1,000.")).toBeVisible();
    await expect(page.getByText("This clue is the source Daily Double")).toBeHidden();

    await wager.fill("5.5");
    await page.getByRole("button", { name: "Lock wager" }).click();
    await expect(page.getByText("Enter a whole-dollar wager from $5 to $1,000.")).toBeVisible();

    await wager.fill("1001");
    await page.getByRole("button", { name: "Lock wager" }).click();
    await expect(page.getByText("Enter a whole-dollar wager from $5 to $1,000.")).toBeVisible();
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

  test("reports an abandoned clue when it is closed before the response is viewed", async ({ page }) => {
    await installTelemetrySpy(page);
    await page.goto(appUrl);

    await page.getByRole("textbox", { name: /team name/i }).fill("The A Team");
    await page.getByRole("button", { name: "$600" }).first().click();
    await page.locator("#closeClue").click();

    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "clue_abandoned",
      properties: {
        teamName: "The A Team"
      },
      measurements: {}
    });
  });

  test("reports cheating when a clue is closed after the response is viewed", async ({ page }) => {
    await installTelemetrySpy(page);
    await page.goto(appUrl);

    await page.getByRole("textbox", { name: /team name/i }).fill("The A Team");
    await page.getByRole("button", { name: "$600" }).first().click();
    await page.locator("#clueCard").click();
    await page.locator("#closeClue").click();

    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "clue_cheated",
      properties: {
        teamName: "The A Team"
      },
      measurements: {}
    });
  });

  test("omits the team name from abandoned and cheated clues when it is not configured", async ({ page }) => {
    await installTelemetrySpy(page);
    await page.goto(appUrl);

    const tile = page.getByRole("button", { name: "$600" }).first();
    await tile.click();
    await page.locator("#closeClue").click();
    await tile.click();
    await page.locator("#clueCard").click();
    await page.locator("#closeClue").click();

    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "clue_abandoned",
      properties: {},
      measurements: {}
    });
    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "clue_cheated",
      properties: {},
      measurements: {}
    });
  });

  test("disables unavailable clues without adding them to scoring", async ({ page }) => {
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

  test("saves and restores the team name from localStorage", async ({ page }) => {
    await page.goto(appUrl);

    const teamNameInput = page.getByRole("textbox", { name: /team name/i });
    await expect(teamNameInput).toBeVisible();

    await teamNameInput.fill("The A Team");
    await expect(teamNameInput).toHaveValue("The A Team");

    await page.reload();
    await expect(page.getByRole("textbox", { name: /team name/i })).toHaveValue("The A Team");
  });

  test("opens the leaderboard and shows mocked scores for each filter", async ({ page }) => {
    await routeLeaderboardScores(page);

    await page.goto(appUrl);

    await page.getByRole("button", { name: "Leaderboard" }).click();
    await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "DD Amount" })).toBeVisible();
    await expect(page.locator("#leaderboardBody tr")).toHaveCount(3);
    await expect(page.getByText("The A Team")).toBeVisible();
    await expect(page.locator("#leaderboardBody tr").first()).toContainText("$500");

    await page.getByRole("button", { name: "This week" }).click();
    await expect(page.getByText("Team Two")).toBeVisible();
    await expect(page.getByText("Team Trio")).toBeVisible();

    await page.getByRole("button", { name: "All time" }).click();
    await expect(page.getByText("Team Trio")).toBeVisible();
    await expect(page.locator("#leaderboardSummary")).toHaveText(/Showing 3 teams for All time/);
  });

  test("disables zero-answer submission, then opens and cancels the capped score confirmation", async ({ page }) => {
    let submissions = 0;
    await routeScoreSubmission(page, () => {
      submissions += 1;
    });

    await page.goto(appUrl);
    await page.getByRole("textbox", { name: /team name/i }).fill("The A Team");
    await expect(page.getByRole("button", { name: "Answer a question to submit" })).toBeDisabled();

    await answerTile(page, 0, "Correct");

    await page.getByRole("button", { name: "Submit score for first 1 question" }).click();
    await expect(page.getByRole("dialog", { name: "Submit score" })).toBeVisible();
    await expect(page.locator("#submitScoreSummary")).toHaveText(
      "The A Team: First 1 question: $200 (1 correct, 0 missed) · DD Amount: $0"
    );

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog", { name: "Submit score" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Submit score for first 1 question" })).toBeEnabled();
    expect(submissions).toBe(0);
  });

  test("submits the current score once and disables resubmission", async ({ page }) => {
    const submissions = [];
    await installTelemetrySpy(page);
    await routeScoreSubmission(page, (payload) => {
      submissions.push(payload);
    });

    await page.goto(appUrl);
    await page.getByRole("textbox", { name: /team name/i }).fill("The A Team");
    await answerTile(page, 0, "Correct");
    await expect(page.locator("#netValue")).toHaveText("$200");

    await page.getByRole("button", { name: "Submit score for first 1 question" }).click();
    await expect(page.locator("#submitScoreSummary")).toHaveText(
      "The A Team: First 1 question: $200 (1 correct, 0 missed) · DD Amount: $0"
    );
    await page.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(page.getByRole("button", { name: "Submitted" })).toBeDisabled();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      teamName: "The A Team",
      net: 200,
      correct: 1,
      missed: 0,
      daily_double_amount: 0,
      sourceEpisode: "Show #9999 - Monday, June 1, 2026",
      sourceUrl: latestGameUrl
    });
    await expect.poll(() => page.evaluate(() => window.telemetryEvents)).toContainEqual({
      name: "score_submitted",
      properties: {},
      measurements: {
        net: 200,
        correct: 1,
        missed: 0,
        dailyDoubleAmount: 0,
        questionCount: 1
      }
    });
  });

  test("submits the signed Daily Double result in the score object", async ({ page }) => {
    const submissions = [];
    await routeScoreSubmission(page, (payload) => {
      submissions.push(payload);
    });

    await page.goto(appUrl);
    await page.getByRole("textbox", { name: /team name/i }).fill("The A Team");
    await page.locator(".tile").nth(2).click();
    await page.getByRole("spinbutton", { name: "Wager" }).fill("600");
    await page.getByRole("button", { name: "Lock wager" }).click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Missed" }).click();

    await page.getByRole("button", { name: "Submit score for first 1 question" }).click();
    await expect(page.locator("#submitScoreSummary")).toContainText("DD Amount: -$600");
    await page.getByRole("button", { name: "Submit", exact: true }).click();

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      teamName: "The A Team",
      net: -600,
      correct: 0,
      missed: 1,
      daily_double_amount: -600
    });
  });

  test("submits only the first six answers while keeping later answers in the UI totals", async ({ page }) => {
    const submissions = [];
    await routeScoreSubmission(page, (payload) => {
      submissions.push(payload);
    });

    await page.goto(appUrl);
    await page.getByRole("textbox", { name: /team name/i }).fill("The A Team");

    for (const tileIndex of [0, 1, 3, 4, 6, 7]) {
      await answerTile(page, tileIndex, "Correct");
    }

    await expect(page.getByRole("button", { name: "Submit score for first 6 questions" })).toBeEnabled();

    await page.locator(".tile").nth(2).click();
    await page.getByRole("spinbutton", { name: "Wager" }).fill("500");
    await page.getByRole("button", { name: "Lock wager" }).click();
    await page.locator("#clueCard").click();
    await page.getByRole("button", { name: "Missed" }).click();

    await expect(page.locator("#correctCount")).toHaveText("6");
    await expect(page.locator("#missedCount")).toHaveText("1");
    await expect(page.locator("#netValue")).toHaveText("$1,100");
    await expect(page.getByRole("button", { name: "Submit score for first 6 questions" })).toBeEnabled();

    await page.getByRole("button", { name: "Submit score for first 6 questions" }).click();
    await expect(page.locator("#submitScoreSummary")).toHaveText(
      "The A Team: First 6 questions: $1,600 (6 correct, 0 missed) · DD Amount: $0 · " +
      "1 later answer is not included."
    );
    await page.getByRole("button", { name: "Submit", exact: true }).click();

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      net: 1600,
      correct: 6,
      missed: 0,
      daily_double_amount: 0
    });
  });

  test("keeps gameplay available but disables submission when game rules cannot load", async ({ page }) => {
    await page.route("**/data/game-rules.json", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto(appUrl);

    await expect(page.getByText("SCIENCE & NATURE")).toBeVisible();
    await expect(page.getByRole("button", { name: "Score submission unavailable" })).toBeDisabled();
    await answerTile(page, 0, "Correct");
    await expect(page.locator("#netValue")).toHaveText("$200");
    await expect(page.getByRole("button", { name: "Score submission unavailable" })).toBeDisabled();
  });

  test("surfaces a visible load failure and logs details when local data cannot be loaded", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await routeGameData(page, { status: 500, body: "{}" });

    await page.goto(appUrl);

    await expect(page.getByText("Couldn't load latest game")).toBeVisible();
    await expect.poll(() => errors.some((message) => message.includes("Couldn't load latest game"))).toBe(true);
  });

  test("reports handled board-loading failures", async ({ page }) => {
    await installTelemetrySpy(page);
    await routeGameData(page, { status: 500, body: "{}" });

    await page.goto(appUrl);

    await expect.poll(() => page.evaluate(() => window.telemetryExceptions)).toContainEqual({
      message: "Game data returned status 500",
      properties: { operation: "board_load" }
    });
  });

  test("rejects generated data without one playable Daily Double", async ({ page }) => {
    const board = testBoard();
    delete board.dailyDoubleClueId;
    await routeGameData(page, { body: JSON.stringify(board) });

    await page.goto(appUrl);

    await expect(page.getByText("Couldn't load latest game")).toBeVisible();
    await expect(page.locator("#board")).toBeHidden();
  });

  test("keeps MVP scope controls out of the UI", async ({ page }) => {
    await page.goto(appUrl);

    await expect(page.getByRole("button", { name: /new game|reload latest/i })).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /correct|missed/i })).toHaveCount(0);
  });
});

test("static file loads only local generated data and self-hosted dependencies", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  const scriptSources = Array.from(html.matchAll(/<script\s+[^>]*src="([^"]+)"/gi), (match) => match[1]);
  expect(scriptSources).toEqual([
    "telemetry-config.js",
    "node_modules/@microsoft/applicationinsights-web/browser/es5/ai.3.gbl.min.js",
    "telemetry.js"
  ]);
  expect(scriptSources.every((source) => !/^https?:/i.test(source))).toBe(true);
  expect(html).not.toMatch(/<link\s+[^>]*rel=["']?stylesheet/i);
  expect(html).not.toMatch(/<img\b/i);
  expect(html).not.toContain("sample");
  expect(html).not.toContain("api.codetabs.com");
  expect(html).not.toContain("api.allorigins.win");
  expect(html).not.toContain("www.j-archive.com");
  expect(html).toContain('const GAME_DATA_URL = "data/latest-game.json";');
});

test("generated game data is available in the repository", async () => {
  const dataPath = path.join(__dirname, "..", "data", "latest-game.json");
  const board = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  expect(board.episodeUrl).toMatch(/^https:\/\/www\.j-archive\.com\/showgame\.php\?game_id=\d+$/);
  expect(board.selectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(["latest", "fallback"]).toContain(board.selectionMode);
  expect(board.categories).toHaveLength(6);
  expect(board.clues.length).toBeGreaterThanOrEqual(1);
  expect(board.clues.filter((clue) => clue.id === board.dailyDoubleClueId && clue.status === "available")).toHaveLength(1);
  expect(board.clues.find((clue) => clue.id === board.dailyDoubleClueId).numericValue).toBe(0);
});

async function routeGameData(page, options = {}) {
  await page.route("**/data/latest-game.json", async (route) => {
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    await route.fulfill({
      status: options.status || 200,
      contentType: "application/json",
      body: options.body || JSON.stringify(testBoard())
    });
  });
}

async function installTelemetrySpy(page) {
  await page.route("**/telemetry-config.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: 'window.jeopardyTelemetryConfig = { connectionString: "InstrumentationKey=test-key" };'
  }));
  await page.route("**/ai.3.gbl.min.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      window.telemetryEvents = [];
      window.telemetryExceptions = [];
      window.Microsoft = { ApplicationInsights: { ApplicationInsights: class {
        addTelemetryInitializer() {}
        loadAppInsights() {}
        trackPageView() {}
        trackEvent(event) { window.telemetryEvents.push(event); }
        trackException(details) {
          window.telemetryExceptions.push({
            message: details.exception.message,
            properties: details.properties
          });
        }
      } } };
    `
  }));
}

async function routeLeaderboardScores(page) {
  await page.route("**/api/scores?filter=*", async (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get("filter");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: testScores(filter) })
    });
  });
}

async function routeScoreSubmission(page, onSubmit) {
  await page.route("**/api/scores", async (route) => {
    const payload = route.request().postDataJSON();
    onSubmit(payload);

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ score: payload })
    });
  });
}

async function answerTile(page, tileIndex, outcome) {
  await page.locator(".tile").nth(tileIndex).click();
  await expect(page.getByRole("button", { name: "Close clue" })).toBeEnabled();
  await page.locator("#clueCard").click();
  const outcomeButton = page.getByRole("button", { name: outcome, exact: true });
  await expect(outcomeButton).toBeVisible();
  await outcomeButton.click();
  await expect(page.locator("#overlay")).toBeHidden();
}

function testScores(filter) {
  const scores = [
    { teamName: "The A Team", score: 1200, daily_double_amount: 500, correct: 3, missed: 1, games: 1 },
    { teamName: "Team Two", score: 800, daily_double_amount: -200, correct: 2, missed: 0, games: 1 },
    { teamName: "Team Trio", score: 400, correct: 1, missed: 1, games: 1 }
  ];

  if (filter === "this-week") {
    return scores.slice().reverse();
  }

  return scores;
}

function testBoard() {
  const categories = [
    "SCIENCE & NATURE",
    "WORDPLAY",
    "DAILY DOUBLE-ISH",
    "MALFORMED",
    "MISSING",
    "ALL MEDIA"
  ].map((title, index) => ({
    id: "category-" + index,
    title,
    comment: index === 0 ? "(A note about the science category.)" : ""
  }));

  return {
    episodeUrl: latestGameUrl,
    episodeTitle: "Show #9999 - Monday, June 1, 2026",
    dailyDoubleClueId: "category-2-row-0",
    categories,
    clues: [
      available(0, 0, "$200", "A mass of cytoplasm bound by a membrane, it's the smallest independently functioning unit of living matter", "a cell"),
      available(1, 0, "$200", "This clue has formatting and extra spacing", "kept exactly"),
      available(2, 0, "$200", "This clue is the source Daily Double", "a special response"),
      available(3, 0, "$200", "Playable malformed-category clue", "fine"),
      available(4, 0, "$200", "Playable missing-category clue", "fine"),
      unavailable(5, 0),
      available(0, 1, "$400", "Science clue 400", "science 400"),
      available(1, 1, "$400", "Word clue 400", "word 400"),
      available(2, 1, "$400", "Daily clue 400", "daily 400"),
      unavailable(3, 1),
      unavailable(4, 1),
      unavailable(5, 1),
      available(0, 2, "$600", "Science clue 600", "science 600"),
      available(1, 2, "$600", "Word clue 600", "word 600"),
      available(2, 2, "$600", "Daily clue 600", "daily 600"),
      available(3, 2, "$600", "Malformed category playable 600", "fine"),
      available(4, 2, "$600", "Missing category playable 600", "fine"),
      unavailable(5, 2),
      available(0, 3, "$800", "Science clue 800", "science 800"),
      available(1, 3, "$800", "Word clue 800", "word 800"),
      available(2, 3, "$800", "Daily clue 800", "daily 800"),
      available(3, 3, "$800", "Malformed category playable 800", "fine"),
      available(4, 3, "$800", "Missing category playable 800", "fine"),
      unavailable(5, 3),
      available(0, 4, "$1000", "Science clue 1000", "science 1000"),
      available(1, 4, "$1,234", "Word clue 1000", "word 1000"),
      available(2, 4, "$1000", "Daily clue 1000", "daily 1000"),
      available(3, 4, "$1000", "Malformed category playable 1000", "fine"),
      available(4, 4, "$1000", "Missing category playable 1000", "fine"),
      unavailable(5, 4)
    ]
  };
}

function available(categoryIndex, rowIndex, value, clueText, response) {
  return {
    id: "category-" + categoryIndex + "-row-" + rowIndex,
    categoryId: "category-" + categoryIndex,
    rowIndex,
    categoryIndex,
    value,
    numericValue: Number(value.replace(/[^\d.-]/g, "")),
    clueText,
    response,
    status: "available",
    outcome: null
  };
}

function unavailable(categoryIndex, rowIndex) {
  return {
    id: "category-" + categoryIndex + "-row-" + rowIndex,
    categoryId: "category-" + categoryIndex,
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
