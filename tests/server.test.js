const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLeaderboardApp } = require("../server-app");

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
  assert.equal(payload.score.daily_double_amount, -750);
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
