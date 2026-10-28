(function initializeCheaterboard(global) {
  "use strict";

  let apiUrl;
  let requestVersion = 0;
  let recordingFailed = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function knownDetails(user) {
    const details = [];
    function visit(value, label) {
      if (value === null || value === undefined || value === "") return;
      const title = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase().replace(/\bid\b/g, "ID");
      if (Array.isArray(value)) {
        if (value.length) details.push([title, value.join(", ")]);
      } else if (typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          const name = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bId\b/, "ID");
          visit(child, label ? `${label} · ${name}` : name);
        }
      } else {
        details.push([title, String(value)]);
      }
    }
    visit(user, "");
    return details;
  }

  function renderPlayers(payload) {
    const container = document.getElementById("cheaterboardResults");
    container.replaceChildren();
    const players = payload.players || [];
    const metrics = element("div", "cheaterboard-metrics");
    for (const [value, label] of [
      [payload.totalEvents || 0, "Cheat events · all time"],
      [players.length, "Anonymous players recorded"],
      [payload.namedTeams || 0, "Named teams represented"]
    ]) {
      const metric = element("div", "cheaterboard-metric");
      metric.append(element("strong", "", String(value)), element("span", "", label));
      metrics.append(metric);
    }
    container.append(metrics);
    if (!players.length) {
      container.append(element("p", "cheaterboard-status", "No cheat events recorded yet."));
      return;
    }
    container.append(element("p", "cheaterboard-status", "All time · ranked by cheat events. Select Details to inspect known information."));
    const table = element("table", "cheaterboard-table");
    table.setAttribute("aria-label", "Cheaterboard rankings");
    const head = element("thead");
    const headings = element("tr");
    for (const label of ["#", "Team / player", "Cheats ↓", "Last caught", "Details"]) {
      const cell = element("th", "", label);
      cell.scope = "col";
      headings.append(cell);
    }
    head.append(headings);
    const body = element("tbody");
    players.forEach((player, index) => {
      const user = player.user || {};
      const name = player.teamName || user.guestName || `Guest-${player.anonymousId.slice(0, 8)}`;
      const row = element("tr");
      row.append(element("td", "", String(index + 1).padStart(2, "0")));
      const identity = element("td");
      identity.append(element("strong", "", name));
      if (player.teamName && user.guestName) identity.append(element("span", "cheaterboard-guest", user.guestName));
      row.append(identity);
      const count = element("td");
      count.append(element("strong", "cheaterboard-count", String(player.cheats)));
      row.append(count, element("td", "", new Date(player.lastCaught).toLocaleString()));
      const action = element("td");
      const button = element("button", "cheaterboard-details-button", "Details ⌄");
      button.type = "button";
      button.setAttribute("aria-label", `Details for ${name}`);
      button.setAttribute("aria-expanded", "false");
      const detailRow = element("tr", "cheaterboard-details");
      detailRow.id = `cheaterboard-details-${index}`;
      detailRow.hidden = true;
      button.setAttribute("aria-controls", detailRow.id);
      const cell = element("td");
      cell.colSpan = 5;
      const list = element("dl");
      for (const [label, value] of knownDetails(user)) {
        const field = element("div");
        field.append(element("dt", "", label), element("dd", "", value));
        list.append(field);
      }
      cell.append(element("p", "eyebrow", "Known player details · latest known values"), list);
      detailRow.append(cell);
      button.addEventListener("click", () => {
        detailRow.hidden = !detailRow.hidden;
        button.setAttribute("aria-expanded", String(!detailRow.hidden));
        button.textContent = detailRow.hidden ? "Details ⌄" : "Less ⌃";
      });
      action.append(button);
      row.append(action);
      body.append(row, detailRow);
    });
    table.append(head, body);
    container.append(table);
  }

  async function render() {
    const version = ++requestVersion;
    const status = document.getElementById("cheaterboardStatus");
    status.textContent = "Loading Cheaterboard…";
    document.getElementById("cheaterboardResults").replaceChildren();
    try {
      const response = await fetch(apiUrl, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Cheaterboard unavailable");
      const payload = await response.json();
      if (version !== requestVersion) return;
      renderPlayers(payload);
      status.textContent = recordingFailed ? "A recent cheat event could not be saved. Counts may be incomplete." : "";
    } catch {
      if (version !== requestVersion) return;
      status.textContent = "Unable to load Cheaterboard. Select Cheaterboard again to retry.";
    }
  }

  async function record(properties = {}) {
    // Capture once: retries reuse the event ID and the context at the time of the event.
    const event = {
      eventId: global.crypto.randomUUID(),
      ...properties,
      user: global.jeopardyTelemetry.getUserContext()
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
          keepalive: true,
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) return;
        if (response.status < 500) break;
      } catch { /* Retry once without blocking clue closing or scoring. */ }
    }
    recordingFailed = true;
    const status = document.getElementById("cheaterboardStatus");
    if (status) status.textContent = "A recent cheat event could not be saved. Counts may be incomplete.";
  }

  global.jeopardyCheaterboard = {
    setup(url) { apiUrl = url; },
    render,
    record
  };
}(window));
