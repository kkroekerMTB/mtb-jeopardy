const GAME_TIME_ZONE = "America/New_York";

function getGameDay(now) {
  const parts = getZonedParts(now, GAME_TIME_ZONE);
  const selectionDate = [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
  const targetMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  let cutoffTime = targetMidnight;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = getZonedParts(new Date(cutoffTime), GAME_TIME_ZONE, true);
    const representedTime = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    cutoffTime += targetMidnight - representedTime;
  }

  return {
    selectionDate,
    cutoff: new Date(cutoffTime)
  };
}

function getZonedParts(date, timeZone, includeTime = false) {
  const options = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  };

  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.second = "2-digit";
    options.hourCycle = "h23";
  }

  const values = {};
  for (const part of new Intl.DateTimeFormat("en-CA", options).formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return values;
}

module.exports = {
  getGameDay
};
