const { initializeServerTelemetry } = require("./server-telemetry");

initializeServerTelemetry();

const { TableClient } = require('@azure/data-tables');
const { createLeaderboardApp } = require('./server-app');

const port = process.env.PORT || 4174;

const connectionString = process.env.AZURE_TABLE_CONNECTION_STRING ||
    'DefaultEndpointsProtocol=https;AccountName=REDACTED;AccountKey=REDACTED;EndpointSuffix=core.windows.net';
const tableName = 'scores';
const client = TableClient.fromConnectionString(connectionString, tableName);
const app = createLeaderboardApp(client);

app.listen(port, () => {
    console.log(`Leaderboard API server running at http://localhost:${port}`);
});
