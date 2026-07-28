const { test, expect } = require("@playwright/test");
const { refreshGameData } = require("../scripts/update-latest-game");

const HOME_URL = "https://archive.test/";
const RECENT_URL = "https://archive.test/season-42";
const LATEST_URL = "https://archive.test/showgame.php?game_id=9999";
const SCORES_URL = "https://scores.test/api/source-episodes";

test("selects the newest playable episode when it was not previously used", async ({ page }) => {
  await page.route("https://archive.test/**", async (route) => {
    const url = route.request().url();

    if (url === HOME_URL) {
      return route.fulfill({ contentType: "text/html", body: archiveHome() });
    }

    if (url === RECENT_URL) {
      return route.fulfill({
        contentType: "text/html",
        body: episodeListing([{ url: LATEST_URL, showNumber: "9999", airedDate: "2026-07-27" }])
      });
    }

    if (url === LATEST_URL) {
      return route.fulfill({
        contentType: "text/html",
        body: episodePage("Show #9999 - Monday, July 27, 2026")
      });
    }

    return route.abort();
  });

  const requests = [];
  const board = await refreshGameData({
    page,
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({ sourceEpisodes: ["Show #9155 - Friday, July 26, 2024"] });
    },
    now: new Date("2026-07-28T14:00:00.000Z"),
    jArchiveHomeUrl: HOME_URL,
    scoresApiUrl: SCORES_URL
  });

  expect(board).toMatchObject({
    episodeUrl: LATEST_URL,
    episodeTitle: "Show #9999 - Monday, July 27, 2026",
    selectionDate: "2026-07-28",
    selectionMode: "latest"
  });
  expect(requests).toEqual([
    `${SCORES_URL}?before=${encodeURIComponent("2026-07-28T04:00:00.000Z")}`
  ]);
});

test("reuses the published board selected on the same New York day", async ({ page }) => {
  const currentGameDataUrl = "https://pages.test/data/latest-game.json";
  const publishedBoard = {
    episodeUrl: "https://archive.test/showgame.php?game_id=9155",
    episodeTitle: "Show #9155 - Friday, July 26, 2024",
    categories: [{ id: "category-0", title: "FIRST" }],
    clues: [{
      id: "category-0-row-0",
      categoryId: "category-0",
      rowIndex: 0,
      categoryIndex: 0,
      status: "available"
    }],
    dailyDoubleClueId: "category-0-row-0",
    selectionDate: "2026-07-28",
    selectionMode: "fallback"
  };
  const requests = [];

  const board = await refreshGameData({
    page,
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse(publishedBoard);
    },
    now: new Date("2026-07-28T23:30:00.000Z"),
    jArchiveHomeUrl: HOME_URL,
    scoresApiUrl: SCORES_URL,
    currentGameDataUrl
  });

  expect(board).toEqual(publishedBoard);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain(currentGameDataUrl);
});

test("selects the same unused season 40 fallback when the latest episode was used", async ({ page }) => {
  const seasonUrl = "https://archive.test/showseason.php?season=40";
  const fallbackEpisodes = [
    {
      url: "https://archive.test/showgame.php?game_id=9155",
      showNumber: "9155",
      airedDate: "2024-07-26"
    },
    {
      url: "https://archive.test/showgame.php?game_id=9154",
      showNumber: "9154",
      airedDate: "2024-07-25"
    },
    {
      url: "https://archive.test/showgame.php?game_id=9153",
      showNumber: "9153",
      airedDate: "2024-07-24"
    }
  ];

  await page.route("https://archive.test/**", async (route) => {
    const url = route.request().url();

    if (url === HOME_URL) {
      return route.fulfill({ contentType: "text/html", body: archiveHome() });
    }

    if (url === RECENT_URL) {
      return route.fulfill({
        contentType: "text/html",
        body: episodeListing([{ url: LATEST_URL, showNumber: "9999", airedDate: "2026-07-27" }])
      });
    }

    if (url === seasonUrl) {
      return route.fulfill({
        contentType: "text/html",
        body: episodeListing(fallbackEpisodes)
      });
    }

    if (url === LATEST_URL) {
      return route.fulfill({
        contentType: "text/html",
        body: episodePage("Show #9999 - Monday, July 27, 2026")
      });
    }

    const fallback = fallbackEpisodes.find((episode) => episode.url === url);
    if (fallback) {
      return route.fulfill({
        contentType: "text/html",
        body: episodePage("")
      });
    }

    return route.abort();
  });

  const options = {
    page,
    fetchImpl: async () => jsonResponse({
      sourceEpisodes: [
        "Show #9999 - Monday, July 27, 2026",
        "Previously formatted episode #9154"
      ]
    }),
    now: new Date("2026-07-28T14:00:00.000Z"),
    jArchiveHomeUrl: HOME_URL,
    scoresApiUrl: SCORES_URL,
    fallbackSeasons: [40],
    seasonUrlTemplate: "https://archive.test/showseason.php?season={season}"
  };

  const first = await refreshGameData(options);
  const second = await refreshGameData(options);

  expect(first.selectionMode).toBe("fallback");
  expect(first.episodeUrl).toBe(second.episodeUrl);
  expect(first.episodeTitle).toBe(second.episodeTitle);
  expect(first.episodeUrl).not.toContain("game_id=9154");
  expect(fallbackEpisodes.map((episode) => episode.url)).toContain(first.episodeUrl);
  expect(first.episodeTitle).toMatch(/^Show #(9153|9155) - /);
});

test("uses available fallback seasons when recent discovery and another season fail", async ({ page }) => {
  const fallbackUrl = "https://archive.test/showgame.php?game_id=9155";
  let failedSeasonRequests = 0;

  await page.route("https://archive.test/**", async (route) => {
    const url = route.request().url();

    if (url === "https://archive.test/showseason.php?season=40") {
      return route.fulfill({
        contentType: "text/html",
        body: episodeListing([{
          url: fallbackUrl,
          showNumber: "9155",
          airedDate: "2024-07-26"
        }])
      });
    }

    if (url === fallbackUrl) {
      return route.fulfill({
        contentType: "text/html",
        body: episodePage("Show #9155 - Friday, July 26, 2024")
      });
    }

    if (url === "https://archive.test/showseason.php?season=39") {
      failedSeasonRequests += 1;
    }

    return route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "Unavailable"
    });
  });

  const board = await refreshGameData({
    page,
    fetchImpl: async () => jsonResponse({ sourceEpisodes: [] }),
    now: new Date("2026-07-28T14:00:00.000Z"),
    jArchiveHomeUrl: HOME_URL,
    scoresApiUrl: SCORES_URL,
    fallbackSeasons: [39, 40],
    seasonUrlTemplate: "https://archive.test/showseason.php?season={season}"
  });

  expect(board).toMatchObject({
    episodeUrl: fallbackUrl,
    selectionDate: "2026-07-28",
    selectionMode: "fallback"
  });
  expect(failedSeasonRequests).toBe(2);
});

test("fails closed before contacting JArchive when used episodes cannot be loaded", async ({ page }) => {
  let archiveRequests = 0;
  await page.route("https://archive.test/**", async (route) => {
    archiveRequests += 1;
    return route.abort();
  });

  await expect(refreshGameData({
    page,
    fetchImpl: async () => jsonResponse({ error: "Unavailable" }, 503),
    now: new Date("2026-07-28T14:00:00.000Z"),
    jArchiveHomeUrl: HOME_URL,
    scoresApiUrl: SCORES_URL
  })).rejects.toThrow("Used episode lookup failed with status 503.");

  expect(archiveRequests).toBe(0);
});

test("stops after 25 unplayable fallback candidates", async ({ page }) => {
  const fallbackEpisodes = Array.from({ length: 30 }, (_, index) => ({
    url: `https://archive.test/showgame.php?game_id=${8000 + index}`,
    showNumber: String(8000 + index),
    airedDate: `2020-01-${String((index % 28) + 1).padStart(2, "0")}`
  }));
  let fallbackEpisodeRequests = 0;

  await page.route("https://archive.test/**", async (route) => {
    const url = route.request().url();

    if (url === "https://archive.test/showseason.php?season=40") {
      return route.fulfill({
        contentType: "text/html",
        body: episodeListing(fallbackEpisodes)
      });
    }

    if (fallbackEpisodes.some((episode) => episode.url === url)) {
      fallbackEpisodeRequests += 1;
      return route.fulfill({
        contentType: "text/html",
        body: "<div id=\"game_title\">No board</div>"
      });
    }

    return route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "Unavailable"
    });
  });

  await expect(refreshGameData({
    page,
    fetchImpl: async () => jsonResponse({ sourceEpisodes: [] }),
    now: new Date("2026-07-28T14:00:00.000Z"),
    jArchiveHomeUrl: HOME_URL,
    scoresApiUrl: SCORES_URL,
    fallbackSeasons: [40],
    seasonUrlTemplate: "https://archive.test/showseason.php?season={season}"
  })).rejects.toThrow("No playable fallback episode was found after 25 attempts.");

  expect(fallbackEpisodeRequests).toBe(25);
});

function archiveHome() {
  return `
    <table><tbody><tr><td>
      <p>One</p><p>Two</p><p><a href="/old">Old</a><a href="/season-42">Recent</a></p>
    </td></tr></tbody></table>
  `;
}

function episodeListing(episodes) {
  const rows = episodes.map((episode) => `
    <tr><td><a href="${episode.url}">#${episode.showNumber}, aired ${episode.airedDate}</a></td></tr>
  `).join("");
  return `<div id="content"><table><tbody>${rows}</tbody></table></div>`;
}

function episodePage(title) {
  return `
    <div id="game_title">${title}</div>
    <table class="round">
      <tbody>
        <tr>
          <td class="category"><div class="category_name">FIRST</div></td>
          <td class="category"><div class="category_name">SECOND</div></td>
        </tr>
        <tr>
          ${clueCell("$200", "First clue", "first response")}
          ${clueCell("$200", "Second clue", "second response", true)}
        </tr>
      </tbody>
    </table>
  `;
}

function clueCell(value, clue, response, dailyDouble = false) {
  const valueClass = dailyDouble ? "clue_value_daily_double" : "clue_value";
  return `
    <td class="clue">
      <table><tbody>
        <tr><td class="${valueClass}">${dailyDouble ? "DD: $1,000" : value}</td></tr>
        <tr><td class="clue_text">${clue}</td></tr>
      </tbody></table>
      <em class="correct_response">${response}</em>
    </td>
  `;
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}
