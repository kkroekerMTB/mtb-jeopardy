const CHEAT_PARTITION = "clue_cheated";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_FIELDS = {
    anonymousId: 256, guestName: 256, sessionId: 256,
    browser: { name: 80, version: 80, language: 64, languages: "languages" },
    device: { type: 32, operatingSystem: 80, screen: { width: "dimension", height: "dimension" } },
    timeZone: 100,
    identity: { displayName: 120, email: 254, authenticatedId: 256 },
    location: { city: 120, region: 120, country: 120 }
};

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, limit) {
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
        throw new Error("Invalid string field.");
    }
    return value.trim();
}

// Build a fresh allowlisted object; never persist arbitrary client properties.
function sanitizeUser(value, fields = USER_FIELDS) {
    if (!isObject(value)) throw new Error("User context must be an object.");
    const result = {};
    for (const [key, rule] of Object.entries(fields)) {
        if (!Object.hasOwn(value, key) || value[key] == null) continue;
        const field = value[key];
        if (typeof rule === "number") {
            const text = boundedString(field, rule);
            if (text) result[key] = text;
        } else if (rule === "languages") {
            if (!Array.isArray(field) || field.length > 20) throw new Error("Invalid browser languages.");
            const languages = field.map((language) => boundedString(language, 64)).filter(Boolean);
            if (languages.length) result[key] = languages;
        } else if (rule === "dimension") {
            if (!Number.isInteger(field) || field < 1 || field > 32768) throw new Error("Invalid screen dimension.");
            result[key] = field;
        } else {
            const child = sanitizeUser(field, rule);
            if (Object.keys(child).length) result[key] = child;
        }
    }
    return result;
}

function mergeKnown(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (isObject(value)) {
            target[key] = mergeKnown(target[key] || {}, value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

function registerCheaterboard(app, client) {
    app.use("/api/cheats", (req, res, next) => {
        if (!client) {
            return res.status(503).json({ error: "Cheaterboard storage is unavailable." });
        }
        return next();
    });

    app.post("/api/cheats", async (req, res) => {
        let eventId, teamName, user;
        try {
            if (!isObject(req.body) || !UUID.test(req.body.eventId)) throw new Error("Invalid event ID.");
            eventId = req.body.eventId.toLowerCase();
            user = sanitizeUser(req.body.user);
            if (!user.anonymousId) throw new Error("Anonymous ID is required.");
            if (req.body.teamName != null) teamName = boundedString(req.body.teamName, 1024);
        } catch {
            return res.status(400).json({ error: "Invalid cheat event or user context." });
        }
        const entity = {
            partitionKey: CHEAT_PARTITION,
            rowKey: eventId,
            caughtAt: new Date().toISOString(),
            user: JSON.stringify(user)
        };
        if (teamName) entity.teamName = teamName;
        try {
            await client.createEntity(entity);
            return res.status(201).json({ eventId });
        } catch (error) {
            if (error.statusCode === 409 && error.code === "EntityAlreadyExists") {
                return res.status(200).json({ eventId });
            }
            console.error("Error recording cheat event:", error);
            return res.status(500).json({ error: "Failed to record cheat event." });
        }
    });

    app.get("/api/cheats", async (req, res) => {
        const players = new Map();
        const teams = new Set();
        let totalEvents = 0;
        try {
            const events = [];
            for await (const entity of client.listEntities({
                queryOptions: { filter: `PartitionKey eq '${CHEAT_PARTITION}'` }
            })) {
                events.push(entity);
            }
            // Table iteration is key order, not event time. UUID breaks timestamp ties.
            events.sort((a, b) => compareText(a.caughtAt, b.caughtAt) || compareText(a.rowKey, b.rowKey));
            for (const entity of events) {
                const user = sanitizeUser(JSON.parse(entity.user));
                const player = players.get(user.anonymousId) || {
                    anonymousId: user.anonymousId, user: {}, cheats: 0,
                    firstCaught: entity.caughtAt, lastCaught: entity.caughtAt
                };
                mergeKnown(player.user, user);
                player.lastCaught = entity.caughtAt;
                player.cheats++;
                totalEvents++;
                if (entity.teamName) {
                    player.teamName = entity.teamName;
                    teams.add(entity.teamName);
                }
                players.set(user.anonymousId, player);
            }
            return res.json({
                players: [...players.values()].sort((a, b) => b.cheats - a.cheats || compareText(a.anonymousId, b.anonymousId)),
                totalEvents, namedTeams: teams.size
            });
        } catch (error) {
            console.error("Error loading Cheaterboard:", error);
            return res.status(500).json({ error: "Failed to load Cheaterboard." });
        }
    });
}

module.exports = { registerCheaterboard };
