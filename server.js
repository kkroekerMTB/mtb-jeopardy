const { initializeServerTelemetry } = require("./server-telemetry");

initializeServerTelemetry();

const { TableClient } = require('@azure/data-tables');
const { createLeaderboardApp } = require('./server-app');

async function startServer({ client, cheatClient, port = process.env.PORT || 4174, host } = {}) {
    const connectionString = process.env.AZURE_TABLE_CONNECTION_STRING ||
        'DefaultEndpointsProtocol=https;AccountName=REDACTED;AccountKey=REDACTED;EndpointSuffix=core.windows.net';
    client ||= TableClient.fromConnectionString(connectionString, 'scores');
    cheatClient ||= TableClient.fromConnectionString(connectionString, 'cheats');
    try {
        await cheatClient.createTable();
    } catch (error) {
        if (error.statusCode !== 409 || error.code !== 'TableAlreadyExists') {
            console.error('Cheaterboard storage initialization failed; cheats API is unavailable:', error);
            cheatClient = undefined;
        }
    }

    const app = createLeaderboardApp(client, { cheatClient });
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            console.log(`Leaderboard API server running on port ${server.address().port}`);
            resolve(server);
        });
        server.once('error', reject);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Failed to start leaderboard server:', error);
        process.exitCode = 1;
    });
}

module.exports = { startServer };
