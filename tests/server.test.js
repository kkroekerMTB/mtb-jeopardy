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
