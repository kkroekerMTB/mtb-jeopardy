const { test, expect } = require("@playwright/test");

const appUrl = "http://127.0.0.1:4173/index.html";

function boardData() {
  const categories = Array.from({ length: 6 }, (_, index) => ({ id: `category-${index}`, title: `Category ${index + 1}` }));
  return {
    episodeTitle: "Random selection test",
    dailyDoubleClueId: "clue-5-4",
    categories,
    clues: categories.flatMap((category, categoryIndex) => Array.from({ length: 5 }, (_, rowIndex) => ({
      id: `clue-${categoryIndex}-${rowIndex}`, categoryId: category.id, categoryIndex, rowIndex,
      status: "available", value: `$${(rowIndex + 1) * 200}`, numericValue: (rowIndex + 1) * 200,
      clueText: `Question ${categoryIndex + 1}-${rowIndex + 1}`, response: "An answer"
    })))
  };
}

async function loadBoard(page, board = boardData()) {
  await page.addInitScript(() => {
    localStorage.setItem("standup-jeopardy-location-invitation-seen", "yes");
    localStorage.setItem("standup-jeopardy-theme-music-enabled", "false");
    Math.random = () => 0.4;
  });
  await page.route("**/data/latest-game.json", route => route.fulfill({ json: board }));
  await page.goto(appUrl);
  await expect(page.locator(".tile")).toHaveCount(30);
}

test("category random locks competing controls, loops downward, and opens its chosen question", async ({ page }) => {
  await loadBoard(page);
  await page.evaluate(() => {
    window.highlightedQuestions = [];
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target.matches(".tile.random-highlight") &&
          window.highlightedQuestions.at(-1) !== record.target.dataset.clueId) {
          window.highlightedQuestions.push(record.target.dataset.clueId);
        }
      }
    }).observe(document.getElementById("board"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  await page.getByRole("button", { name: "Random question in Category 1", exact: true }).click();
  await expect(page.locator(".tile.random-highlight")).toHaveText("$200");
  await expect(page.getByRole("button", { name: "Random question", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Upload Session" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Leaderboard", exact: true })).toBeDisabled();
  await expect(page.locator(".tile").first()).toBeDisabled();
  await expect(page.locator("#overlay")).toBeHidden();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3", { timeout: 4500 });
  await expect(page.getByRole("button", { name: "Upload Session" })).toBeEnabled();
  await expect(page.locator(".random-highlight")).toHaveCount(0);
  expect(await page.evaluate(() => window.highlightedQuestions.slice(0, 7))).toEqual([
    "clue-0-0", "clue-0-1", "clue-0-2", "clue-0-3", "clue-0-4", "clue-0-0", "clue-0-1"
  ]);
});

test("board random samples playable questions equally and still reaches Daily Doubles", async ({ page }) => {
  const board = boardData();
  board.clues.forEach(clue => { clue.status = "unavailable"; });
  for (const id of ["clue-0-0", "clue-0-2", "clue-5-4"]) {
    board.clues.find(clue => clue.id === id).status = "available";
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadBoard(page, board);
  await expect(page.getByRole("button", { name: "Random question in Category 2", exact: true })).toBeDisabled();
  // 0.4 falls on the second of three playable questions, despite uneven categories.
  await page.getByRole("button", { name: "Random question", exact: true }).click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3");
  await expect(page.locator("#closeClue")).toBeEnabled();
  await page.locator("#closeClue").click();
  await expect(page.locator("#overlay")).toBeHidden();
  await page.evaluate(() => { Math.random = () => 0.99; });
  await page.getByRole("button", { name: "Random question", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeVisible();
  await expect(page.locator("#overlayCategory")).toHaveText("Category 6");
});

test("one remaining question skips suspense, stays eligible after closing, and disables random after scoring", async ({ page }) => {
  const board = boardData();
  board.clues.forEach(clue => {
    if (clue.categoryIndex === 0 && clue.rowIndex > 0) clue.outcome = "correct";
  });
  await loadBoard(page, board);
  const random = page.getByRole("button", { name: "Random question in Category 1", exact: true });
  await random.click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-1", { timeout: 1200 });
  await expect(page.locator("#closeClue")).toBeEnabled();
  await page.locator("#closeClue").click();
  await expect(page.locator("#overlay")).toBeHidden();
  await random.click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-1");
  await expect(page.locator("#overlay")).not.toHaveClass(/animating/);
  await page.locator("#clueCard").click();
  await page.getByRole("button", { name: "Correct", exact: true }).click();
  await expect(page.locator("#overlay")).toBeHidden();
  await expect(random).toBeDisabled();
});

test("reduced motion and touch keep the category name and static random hints visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadBoard(page);
  const header = page.getByRole("button", { name: "Random question in Category 1", exact: true });
  await expect(header.locator(".category-title")).toHaveText("Category 1");
  await expect(header.locator(".random-pattern")).toHaveCSS("opacity", "0.45");
  await expect(header.locator(".random-pattern span").first()).toHaveCSS("animation-name", "none");
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3", { timeout: 1200 });
});

test("sound effects can be muted independently and the choice survives reload and Daily Double selection", async ({ page }) => {
  await page.addInitScript(() => {
    window.dailyDoublePlays = 0;
    HTMLMediaElement.prototype.play = function () {
      if (this.id === "dailyDoubleSound") window.dailyDoublePlays += 1;
      return Promise.resolve();
    };
  });
  await loadBoard(page);
  const effects = page.getByRole("checkbox", { name: "Sound effects" });
  await expect(effects).toBeChecked();
  await effects.uncheck();
  await page.reload();
  await expect(effects).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Theme music" })).not.toBeChecked();
  await page.getByRole("button", { name: "Random question in Category 6", exact: true }).click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 6-3");
  await expect(page.locator("#closeClue")).toBeEnabled();
  await page.locator("#closeClue").click();
  await expect(page.locator("#overlay")).toBeHidden();
  await page.locator('[data-clue-id="clue-5-4"]').click();
  await expect(page.getByRole("spinbutton", { name: "Wager" })).toBeVisible();
  expect(await page.evaluate(() => window.dailyDoublePlays)).toBe(0);
});

test("boops slow down and the landing tone is exactly one octave higher", async ({ page }) => {
  await page.addInitScript(() => {
    window.tones = [];
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = when => {
        window.tones.push({ frequency: oscillator.frequency.value, when });
        start(when);
      };
      return oscillator;
    };
  });
  await loadBoard(page);
  await page.getByRole("button", { name: "Random question in Category 1", exact: true }).click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3");
  const tones = await page.evaluate(() => window.tones);
  expect(tones.length).toBeGreaterThan(10);
  const boops = tones.slice(0, -1);
  expect(boops.every(tone => tone.frequency === 440)).toBe(true);
  expect(tones.at(-1).frequency).toBe(880);
  expect(boops.at(-1).when - boops.at(-2).when).toBeGreaterThan(boops[1].when - boops[0].when);
});

test("an exhausted board disables every random control", async ({ page }) => {
  const board = boardData();
  board.clues.forEach(clue => { clue.outcome = "correct"; });
  await loadBoard(page, board);
  await expect(page.getByRole("button", { name: "Random question", exact: true })).toBeDisabled();
  for (const header of await page.locator(".category").all()) await expect(header).toBeDisabled();
});

test("landing-only audio plays after an audio context resumes, including after muting", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.tones = [];
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return new Promise(resolve => setTimeout(() => resolve(resume.call(this)), 40));
    };
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = when => { window.tones.push(oscillator.frequency.value); start(when); };
      return oscillator;
    };
  });
  await loadBoard(page);
  const random = page.getByRole("button", { name: "Random question in Category 1", exact: true });
  await random.click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3");
  await expect(page.locator("#closeClue")).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.tones)).toEqual([880]);
  await page.locator("#closeClue").click();
  await expect(page.locator("#overlay")).toBeHidden();
  const effects = page.getByRole("checkbox", { name: "Sound effects" });
  await effects.uncheck();
  await effects.check();
  await random.click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3");
  await expect.poll(() => page.evaluate(() => window.tones)).toEqual([880, 880]);
});

test("uploaded sessions support random selection even when audio is unavailable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.AudioContext = class { constructor() { throw new Error("Audio unavailable"); } };
  });
  await loadBoard(page);
  await page.locator("#sessionFile").setInputFiles({
    name: "custom.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      categories: Array.from({ length: 6 }, (_, i) => ({
        title: `Uploaded category ${i + 1}`,
        questions: Array.from({ length: 5 }, (_, j) => ({ question: `Uploaded ${i + 1}-${j + 1}`, answer: "Answer" }))
      }))
    }))
  });
  await page.getByRole("button", { name: "Random question in Uploaded category 2", exact: true }).click();
  await expect(page.locator("#overlayClue")).toHaveText("Uploaded 2-3");
});

test("dismissing an invalid upload restores random selection on the current board", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadBoard(page);
  await page.locator("#sessionFile").setInputFiles({
    name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}")
  });
  await expect(page.locator("#uploadErrorOverlay")).toBeVisible();
  await page.locator("#closeUploadError").click();
  const random = page.getByRole("button", { name: "Random question", exact: true });
  await expect(random).toBeEnabled();
  await random.click();
  await expect(page.locator("#overlayClue")).toHaveText("Question 1-3");
});

test.describe("touch controls", () => {
  test.use({ hasTouch: true });
  test("shows the static category hint and starts selection with a single tap", async ({ page }) => {
    await loadBoard(page);
    const header = page.getByRole("button", { name: "Random question in Category 1", exact: true });
    await expect(header.locator(".random-pattern")).toHaveCSS("opacity", "0.45");
    await expect(header.locator(".random-pattern span").first()).toHaveCSS("animation-name", "none");
    await header.tap();
    await expect(page.locator("#overlayClue")).toHaveText("Question 1-3");
  });
});
