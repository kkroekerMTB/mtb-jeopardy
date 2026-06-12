const express = require('express');
const path = require('node:path');
const { TableClient } = require('@azure/data-tables');

const app = express();
const port = process.env.PORT || 4174;

const connectionString = process.env.AZURE_TABLE_CONNECTION_STRING ||
    'DefaultEndpointsProtocol=https;AccountName=REDACTED;AccountKey=REDACTED;EndpointSuffix=core.windows.net';
const tableName = 'scores';
const client = TableClient.fromConnectionString(connectionString, tableName);

app.use('/api', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    return next();
});

function parseScoreEntity(entity) {
    return {
        teamName: entity.partitionKey,
        score: Number(entity.net) || 0,
        correct: Number(entity.correct) || 0,
        missed: Number(entity.missed) || 0,
        games: 1,
        timestamp: entity.timestamp,
        sourceEpisode: entity.source_episode || null,
        rowKey: entity.rowKey
    };
}

function aggregateScores(rows) {
    const totals = new Map();

    for (const row of rows) {
        const team = row.teamName;
        const existing = totals.get(team) || { teamName: team, score: 0, correct: 0, missed: 0, games: 0 };
        existing.score += row.score;
        existing.correct += row.correct;
        existing.missed += row.missed;
        existing.games += 1;
        totals.set(team, existing);
    }

    return Array.from(totals.values()).sort((a, b) => b.score - a.score);
}

function getFilterRange(filterId) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    switch (filterId) {
        case 'today':
            return { start: today.toISOString(), end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString() };
        case 'this-week': {
            const day = today.getUTCDay();
            const weekStart = new Date(today.getTime() - day * 24 * 60 * 60 * 1000);
            return { start: weekStart.toISOString(), end: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() };
        }
        default:
            return null;
    }
}

app.get('/api/scores', async (req, res) => {
    const filterId = req.query.filter || 'today';
    const filterRange = getFilterRange(filterId);

    let rows = [];
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
        console.error('Error fetching leaderboard scores:', error);
        return res.status(500).json({ error: 'Failed to load leaderboard scores' });
    }

    const aggregated = aggregateScores(rows);
    res.json({ scores: aggregated });
});

app.use('/', express.static(path.resolve(__dirname)));

app.listen(port, () => {
    console.log(`Leaderboard API server running at http://localhost:${port}`);
});
