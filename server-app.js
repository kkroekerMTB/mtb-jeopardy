const express = require("express");
const path = require("node:path");

function parseScoreEntity(entity) {
    return {
        teamName: entity.partitionKey,
        score: Number(entity.net) || 0,
        correct: Number(entity.correct) || 0,
        missed: Number(entity.missed) || 0,
        games: 1,
        daily_double_amount: Number(entity.daily_double_amount) || 0,
        timestamp: entity.timestamp,
        sourceEpisode: entity.source_episode || null,
        rowKey: entity.rowKey
    };
}

function createScoreRowKey() {
    return `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidTableKey(value) {
    return typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 1024 &&
        !/[\/\\#?\u0000-\u001f\u007f-\u009f]/.test(value);
}

function parseScoreSubmission(body) {
    const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
    const sourceEpisode = typeof body.sourceEpisode === "string" ? body.sourceEpisode.trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const net = Number(body.net);
    const correct = Number(body.correct);
    const missed = Number(body.missed);
    const dailyDoubleAmount = Number(body.daily_double_amount);

    if (!isValidTableKey(teamName)) {
        return { error: "Team name is required and cannot contain /, \\, #, or ?." };
    }

    if (!Number.isFinite(net) ||
        !Number.isInteger(correct) ||
        !Number.isInteger(missed) ||
        correct < 0 ||
        missed < 0 ||
        !Number.isInteger(dailyDoubleAmount)) {
        return { error: "Score submission is invalid." };
    }

    const entity = {
        partitionKey: teamName,
        rowKey: createScoreRowKey(),
        net,
        correct,
        missed,
        daily_double_amount: dailyDoubleAmount
    };

    if (sourceEpisode) {
        entity.source_episode = sourceEpisode;
    }

    if (sourceUrl) {
        entity.source_url = sourceUrl;
    }

    return { entity };
}

function aggregateScores(rows) {
    const totals = new Map();

    for (const row of rows) {
        const team = row.teamName;
        const existing = totals.get(team) || {
            teamName: team,
            score: 0,
            correct: 0,
            missed: 0,
            games: 0,
            daily_double_amount: 0
        };
        existing.score += row.score;
        existing.correct += row.correct;
        existing.missed += row.missed;
        existing.games += 1;
        existing.daily_double_amount += row.daily_double_amount;
        totals.set(team, existing);
    }

    return Array.from(totals.values()).sort((a, b) => b.score - a.score);
}

function getFilterRange(filterId) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    switch (filterId) {
        case "today":
            return {
                start: today.toISOString(),
                end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
            };
        case "this-week": {
            const day = today.getUTCDay();
            const weekStart = new Date(today.getTime() - day * 24 * 60 * 60 * 1000);
            return {
                start: weekStart.toISOString(),
                end: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            };
        }
        default:
            return null;
    }
}

function parseBeforeCutoff(value) {
    if (typeof value !== "string") {
        return null;
    }

    const cutoff = new Date(value);
    if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString() !== value) {
        return null;
    }

    const earliestEpisode = Date.UTC(1984, 8, 10);
    const clockSkewAllowance = 5 * 60 * 1000;
    if (cutoff.getTime() < earliestEpisode || cutoff.getTime() > Date.now() + clockSkewAllowance) {
        return null;
    }

    return cutoff;
}

function createLeaderboardApp(client) {
    const app = express();

    app.use(express.json({ limit: "16kb" }));

    app.use("/api", (req, res, next) => {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            return res.sendStatus(204);
        }

        return next();
    });

    app.get("/api/source-episodes", async (req, res) => {
        const cutoff = parseBeforeCutoff(req.query.before);

        if (!cutoff) {
            return res.status(400).json({ error: "A valid ISO before timestamp is required." });
        }

        const sourceEpisodes = new Set();
        const query = `Timestamp lt datetime'${cutoff.toISOString()}'`;

        try {
            for await (const entity of client.listEntities({
                queryOptions: {
                    filter: query,
                    select: ["source_episode"]
                }
            })) {
                if (typeof entity.source_episode === "string" && entity.source_episode.trim()) {
                    sourceEpisodes.add(entity.source_episode.trim());
                }
            }
        } catch (error) {
            console.error("Error fetching source episodes:", error);
            return res.status(500).json({ error: "Failed to load source episodes" });
        }

        return res.json({ sourceEpisodes: Array.from(sourceEpisodes).sort() });
    });

    app.get("/api/scores", async (req, res) => {
        const filterId = req.query.filter || "today";
        const filterRange = getFilterRange(filterId);

        const rows = [];
        try {
            if (filterRange) {
                const query = `Timestamp ge datetime'${filterRange.start}' and Timestamp lt datetime'${filterRange.end}'`;
                for await (const entity of client.listEntities({ queryOptions: { filter: query } })) {
                    rows.push(parseScoreEntity(entity));
                }
            } else {
                for await (const entity of client.listEntities()) {
                    rows.push(parseScoreEntity(entity));
                }
            }
        } catch (error) {
            console.error("Error fetching leaderboard scores:", error);
            return res.status(500).json({ error: "Failed to load leaderboard scores" });
        }

        res.json({ scores: aggregateScores(rows) });
    });

    app.post("/api/scores", async (req, res) => {
        const submission = parseScoreSubmission(req.body || {});

        if (submission.error) {
            return res.status(400).json({ error: submission.error });
        }

        try {
            await client.createEntity(submission.entity);
        } catch (error) {
            console.error("Error submitting leaderboard score:", error);
            return res.status(500).json({ error: "Failed to submit leaderboard score" });
        }

        res.status(201).json({
            score: parseScoreEntity({
                ...submission.entity,
                timestamp: new Date().toISOString()
            })
        });
    });

    app.use("/", express.static(path.resolve(__dirname)));

    return app;
}

module.exports = {
    createLeaderboardApp
};
