const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLeaderboardApp } = require("../server-app");

test("server startup enables cheats for newly created and existing tables", async (t) => {
  const { startServer } = require("../server");
  for (const alreadyExists of [false, true]) {
    await t.test(alreadyExists ? "existing table" : "new table", async (t) => {
      const server = await startServer({
        port: 0, host: "127.0.0.1", client: {},
        cheatClient: {
          async createTable() {
            if (alreadyExists) {
              throw Object.assign(new Error("Already exists"), { statusCode: 409, code: "TableAlreadyExists" });
            }
          },
          async *listEntities() {}
        }
      });
      t.after(() => server.close());
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cheats`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { players: [], totalEvents: 0, namedTeams: 0 });
    });
  }
});

test("server startup keeps scores available when cheats table initialization fails", async (t) => {
  const { startServer } = require("../server");
  const scoreRows = [];
  const server = await startServer({
    port: 0, host: "127.0.0.1",
    client: {
      async createEntity(entity) { scoreRows.push(entity); },
      async *listEntities() { yield* scoreRows; }
    },
    cheatClient: {
      async createTable() { throw Object.assign(new Error("Cheats table forbidden"), { statusCode: 403 }); },
      async createEntity() { assert.fail("Unavailable cheats storage must not be used"); },
      async *listEntities() { assert.fail("Unavailable cheats storage must not be used"); }
    }
  });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const posted = await fetch(`${url}/scores`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamName: "Still playing", net: 200, correct: 1, missed: 0, daily_double_amount: 0 })
  });
  assert.equal(posted.status, 201);
  const scores = await fetch(`${url}/scores?filter=all-time`);
  assert.equal(scores.status, 200);
  assert.equal((await scores.json()).scores[0].teamName, "Still playing");
  const getCheats = await fetch(`${url}/cheats`);
  assert.equal(getCheats.status, 503);
  assert.equal(typeof (await getCheats.json()).error, "string");
  const postCheats = await fetch(`${url}/cheats`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId: cheatEventId, user: { anonymousId: "a" } })
  });
  assert.equal(postCheats.status, 503);
  assert.equal(typeof (await postCheats.json()).error, "string");
});

async function startCheatApi(t, cheatClient, scoreClient = {}) {
  const server = createLeaderboardApp(scoreClient, { cheatClient }).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/cheats`;
  return {
    url,
    post: (body) => fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    })
  };
}

function fakeCheatTable(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [row.rowKey, structuredClone(row)]));
  return {
    async createEntity(entity) {
      if (rows.has(entity.rowKey)) {
        throw Object.assign(new Error("Duplicate"), { statusCode: 409, code: "EntityAlreadyExists" });
      }
      rows.set(entity.rowKey, structuredClone(entity));
    },
    async *listEntities() { yield* structuredClone([...rows.values()]); }
  };
}

const cheatEventId = "7e7c4a70-82d6-40b9-969e-9d9481105b45";

test("Cheaterboard merges latest known details chronologically and ranks browser identities", async (t) => {
  const row = (id, caughtAt, user, teamName) => ({
    partitionKey: "clue_cheated", rowKey: id, caughtAt, user: JSON.stringify(user), teamName
  });
  const api = await startCheatApi(t, fakeCheatTable([
    row("z", "2026-10-28T13:00:00.000Z", {
      anonymousId: "b", sessionId: "latest", browser: { version: "144", name: null },
      location: null, identity: { displayName: "New name" }
    }, "New Team"),
    row("a", "2026-10-27T12:00:00.000Z", {
      anonymousId: "b", sessionId: "old", browser: { name: "Firefox", version: "143", languages: ["en"] },
      device: { screen: { width: 1920 } }, location: { city: "Town", country: "US" },
      identity: { displayName: "Old name", authenticatedId: "person" }
    }, "Shared Team"),
    row("c", "2026-10-28T12:00:00.000Z", { anonymousId: "a" }, "Shared Team"),
    row("d", "2026-10-28T13:00:00.000Z", { anonymousId: "a" }, "Shared Team"),
    row("e", "2026-10-28T14:00:00.000Z", { anonymousId: "c" })
  ]));
  const result = await (await fetch(api.url)).json();
  assert.equal(result.totalEvents, 5);
  assert.equal(result.namedTeams, 2);
  assert.deepEqual(result.players.map((p) => [p.anonymousId, p.cheats]), [["a", 2], ["b", 2], ["c", 1]]);
  assert.deepEqual(result.players[1], {
    anonymousId: "b", teamName: "New Team", cheats: 2,
    firstCaught: "2026-10-27T12:00:00.000Z", lastCaught: "2026-10-28T13:00:00.000Z",
    user: {
      anonymousId: "b", sessionId: "latest", browser: { name: "Firefox", version: "144", languages: ["en"] },
      device: { screen: { width: 1920 } }, location: { city: "Town", country: "US" },
      identity: { displayName: "New name", authenticatedId: "person" }
    }
  });
  assert.equal(result.players[2].teamName, undefined);
});

test("cheats API validates input and stores only bounded known context", async (t) => {
  const api = await startCheatApi(t, fakeCheatTable());
  const valid = { eventId: cheatEventId, user: { anonymousId: "stable-local-id" } };
  for (const input of [
    null, [], {}, { ...valid, eventId: "not-a-uuid" },
    { ...valid, user: null }, { ...valid, user: [] }, { ...valid, user: {} },
    { ...valid, user: { anonymousId: " " } },
    { ...valid, user: { anonymousId: 5 } },
    { ...valid, user: { anonymousId: "x".repeat(257) } },
    { ...valid, teamName: 42 }, { ...valid, teamName: "x".repeat(1025) },
    { ...valid, user: { ...valid.user, browser: "Chrome" } },
    { ...valid, user: { ...valid.user, browser: { languages: [4] } } },
    { ...valid, user: { ...valid.user, device: { screen: { width: -1 } } } },
    { ...valid, user: { ...valid.user, identity: { email: {} } } },
    { ...valid, user: { ...valid.user, location: { city: "x".repeat(121) } } }
  ]) {
    const response = await api.post(input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.equal(typeof (await response.json()).error, "string");
  }
  const user = {
    anonymousId: "stable-local-id", guestName: "Guest-stable", sessionId: "session-1",
    browser: { name: "Firefox", version: "144", language: "en-US", languages: ["en-US", "en"] },
    device: { type: "desktop", operatingSystem: "Linux", screen: { width: 1920, height: 1080 } },
    timeZone: "America/New_York", identity: { displayName: "Person", email: "a@example.test", authenticatedId: "id" },
    location: { city: "State College", region: "Pennsylvania", country: "US" }
  };
  const response = await api.post({
    ...valid, user: { ...user, ip: "secret", userAgent: "secret", latitude: 40,
      location: { ...user.location, coordinates: [40, -77], longitude: -77 },
      browser: { ...user.browser, rawUserAgent: "secret" }, __unexpected: { secret: true } }
  });
  assert.equal(response.status, 201);
  const payload = await (await fetch(api.url)).json();
  assert.deepEqual(payload.players[0].user, user);
  assert.equal(payload.totalEvents, 1);
  assert.equal(payload.namedTeams, 0);
});

test("cheats API accepts existing 1024-character team names and rejects 1025 characters", async (t) => {
  const api = await startCheatApi(t, fakeCheatTable());
  const teamName = "x".repeat(1024);
  const submission = { eventId: cheatEventId, teamName, user: { anonymousId: "browser-a" } };
  assert.equal((await api.post({ ...submission, teamName: teamName + "x" })).status, 400);
  assert.equal((await api.post(submission)).status, 201);
  const result = await (await fetch(api.url)).json();
  assert.equal(result.totalEvents, 1);
  assert.equal(result.players[0].teamName, teamName);
});

test("cheat events round trip once across retries without touching scores", async (t) => {
  const api = await startCheatApi(t, fakeCheatTable(), {
    async createEntity() { assert.fail("Cheats must not write scores"); },
    async *listEntities() { yield { partitionKey: "Score Team", net: 200 }; }
  });
  const before = Date.now();
  const submission = {
    eventId: cheatEventId, teamName: "Team / #1?", user: { anonymousId: "browser-a" },
    occurredAt: "1984-01-01T00:00:00.000Z"
  };
  assert.equal((await api.post(submission)).status, 201);
  const first = await (await fetch(api.url)).json();
  assert.equal(first.totalEvents, 1);
  assert.equal(first.namedTeams, 1);
  assert.equal(first.players[0].anonymousId, "browser-a");
  assert.equal(first.players[0].teamName, "Team / #1?");
  assert.equal(first.players[0].cheats, 1);
  assert.ok(Date.parse(first.players[0].lastCaught) >= before);
  assert.equal(first.players[0].firstCaught, first.players[0].lastCaught);
  assert.equal((await api.post({ ...submission, teamName: "Changed", user: { anonymousId: "other" } })).status, 200);
  assert.deepEqual(await (await fetch(api.url)).json(), first);
  const scores = await (await fetch(api.url.replace("/cheats", "/scores?filter=all-time"))).json();
  assert.equal(scores.scores.length, 1);
  assert.equal(scores.scores[0].teamName, "Score Team");
});

test("cheats API reports unavailable storage rather than an empty board", async (t) => {
  const api = await startCheatApi(t);
  for (const response of [await fetch(api.url), await api.post({})]) {
    assert.equal(response.status, 503);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("cheats API returns JSON for malformed requests and storage failures", async (t) => {
  const api = await startCheatApi(t, {
    async createEntity() { throw Object.assign(new Error("private credential detail"), { statusCode: 503 }); },
    async *listEntities() { throw new Error("private credential detail"); }
  });
  for (const [body, expected] of [["{", 400], [JSON.stringify({ padding: "x".repeat(17000) }), 413]]) {
    const response = await fetch(api.url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(response.status, expected);
    assert.equal(typeof (await response.json()).error, "string");
  }
  for (const response of [await fetch(api.url), await api.post({ eventId: cheatEventId, user: { anonymousId: "a" } })]) {
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(typeof payload.error, "string");
    assert.doesNotMatch(payload.error, /private|credential/);
  }
});

test("concurrent retries and UUID casing still represent just one event", async (t) => {
  const api = await startCheatApi(t, fakeCheatTable());
  const replies = await Promise.all([cheatEventId, cheatEventId.toUpperCase(), cheatEventId].map((eventId) =>
    api.post({ eventId, user: { anonymousId: "a", browser: null } })));
  assert.deepEqual(replies.map((response) => response.status).sort(), [200, 200, 201]);
  assert.equal((await (await fetch(api.url)).json()).totalEvents, 1);
});

test("leaderboard API rolls up signed Daily Double amounts and treats legacy rows as zero", async (t) => {
  const tableClient = {
    async *listEntities() {
      yield {
        partitionKey: "The A Team",
        rowKey: "row-1",
        net: 1000,
        correct: 3,
        missed: 1,
        daily_double_amount: 600
      };
      yield {
        partitionKey: "The A Team",
        rowKey: "row-2",
        net: 200,
        correct: 1,
        missed: 0
      };
      yield {
        partitionKey: "Team Two",
        rowKey: "row-3",
        net: -400,
        correct: 0,
        missed: 1,
        daily_double_amount: -400
      };
    }
  };
  const server = createLeaderboardApp(tableClient).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/scores?filter=all-time`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.scores, [
    {
      teamName: "The A Team",
      score: 1200,
      correct: 4,
      missed: 1,
      games: 2,
      daily_double_amount: 600
    },
    {
      teamName: "Team Two",
      score: -400,
      correct: 0,
      missed: 1,
      games: 1,
      daily_double_amount: -400
    }
  ]);
});

test("score API stores and returns the exact daily_double_amount property", async (t) => {
  const createdEntities = [];
  const tableClient = {
    async createEntity(entity) {
      createdEntities.push(entity);
    }
  };
  const server = createLeaderboardApp(tableClient).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      teamName: "The A Team",
      net: -750,
      correct: 0,
      missed: 1,
      daily_double_amount: -750,
      sourceEpisode: "Show #9999",
      sourceUrl: "https://example.test/episode"
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(createdEntities.length, 1);
  assert.equal(createdEntities[0].daily_double_amount, -750);
  assert.equal(createdEntities[0].question_limit, 6);
  assert.equal(payload.score.daily_double_amount, -750);
});

test("score API accepts only one through six answered questions", async (t) => {
  const createdEntities = [];
  const tableClient = {
    async createEntity(entity) {
      createdEntities.push(entity);
    }
  };
  const server = createLeaderboardApp(tableClient).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  for (const score of [
    { correct: 0, missed: 0 },
    { correct: 6, missed: 1 }
  ]) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamName: "The A Team",
        net: 0,
        correct: score.correct,
        missed: score.missed,
        daily_double_amount: 0
      })
    });

    assert.equal(response.status, 400);
  }

  assert.equal(createdEntities.length, 0);
});

test("source episodes API returns distinct titles recorded before the requested cutoff", async (t) => {
  const listCalls = [];
  const tableClient = {
    async *listEntities(options) {
      listCalls.push(options);
      yield { source_episode: " Show #9594 - Thursday, June 25, 2026 " };
      yield { source_episode: "Show #9594 - Thursday, June 25, 2026" };
      yield { source_episode: "Show #9155 - Friday, July 26, 2024" };
      yield { partitionKey: "Legacy Team" };
    }
  };
  const server = createLeaderboardApp(tableClient).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const cutoff = "2026-07-28T04:00:00.000Z";
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/source-episodes?before=${encodeURIComponent(cutoff)}`
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.sourceEpisodes, [
    "Show #9155 - Friday, July 26, 2024",
    "Show #9594 - Thursday, June 25, 2026"
  ]);
  assert.deepEqual(listCalls, [{
    queryOptions: {
      filter: `Timestamp lt datetime'${cutoff}'`,
      select: ["source_episode"]
    }
  }]);
});

test("source episodes API rejects an invalid cutoff without querying storage", async (t) => {
  let queried = false;
  const tableClient = {
    async *listEntities() {
      queried = true;
    }
  };
  const server = createLeaderboardApp(tableClient).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/source-episodes?before=tomorrow`);
  const payload = await response.json();
  const futureResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/source-episodes?before=${encodeURIComponent("2999-01-01T00:00:00.000Z")}`
  );

  assert.equal(response.status, 400);
  assert.equal(payload.error, "A valid ISO before timestamp is required.");
  assert.equal(futureResponse.status, 400);
  assert.equal(queried, false);
});

test("leaderboard API permits Application Insights distributed tracing headers", async (t) => {
  const server = createLeaderboardApp({}).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/scores`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,traceparent,tracestate,request-id,request-context"
    }
  });

  assert.equal(response.status, 204);
  const allowedHeaders = response.headers.get("access-control-allow-headers").toLowerCase();
  for (const header of ["content-type", "traceparent", "tracestate", "request-id", "request-context"]) {
    assert.match(allowedHeaders, new RegExp(`(?:^|,\\s*)${header}(?:,|$)`));
  }
});
