(() => {
  "use strict";

  const PREFERENCE = "standup-jeopardy-location-sharing";
  const INVITATION = "standup-jeopardy-location-invitation-seen";
  const emptyLocation = () => ({ city: null, region: null, country: null });
  let location = emptyLocation();
  let elements;
  let generation = 0;
  let lookupController;
  let lookupTimer;

  function publish(value) {
    location = value;
    window.dispatchEvent(new CustomEvent("jeopardy-location-change", {
      detail: { ...location }
    }));
  }

  function preference(value) {
    try {
      if (value === true) localStorage.setItem(PREFERENCE, "yes");
      else if (value === false) localStorage.removeItem(PREFERENCE);
      else return localStorage.getItem(PREFERENCE) === "yes";
    } catch {
      // Storage can be unavailable; sharing still works for this page.
    }
    return false;
  }

  function render(message, active = false) {
    elements.status.textContent = message;
    elements.share.hidden = active;
    elements.stop.hidden = !active;
  }

  function clearLocation() {
    generation++;
    lookupController?.abort();
    lookupController = null;
    clearTimeout(lookupTimer);
    publish(emptyLocation());
  }

  function fail(clearPreference = false) {
    clearLocation();
    if (clearPreference) preference(false);
    render("Location unavailable. Share location to try again.");
  }

  function stopSharing() {
    clearLocation();
    preference(false);
    render("Location sharing is off.");
  }

  function start() {
    const attempt = ++generation;
    preference(true);
    publish(emptyLocation());
    render("Finding your location…", true);
    if (!navigator.geolocation) return fail(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (attempt !== generation) return;
      try {
        const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
        url.search = new URLSearchParams({
          latitude: coords.latitude, longitude: coords.longitude, localityLanguage: "en"
        });
        lookupController = new AbortController();
        lookupTimer = setTimeout(() => {
          if (attempt === generation) fail();
        }, 10000);
        const response = await fetch(url, {
          referrerPolicy: "no-referrer", signal: lookupController.signal
        });
        if (!response.ok) throw new Error("Location unavailable");
        const data = await response.json();
        if (attempt !== generation) return;
        const text = (value) => typeof value === "string"
          ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 120) || null
          : null;
        const value = {
          city: text(data.city) || text(data.locality),
          region: text(data.principalSubdivision),
          country: text(data.countryName)
        };
        if (!Object.values(value).some(Boolean)) throw new Error("Location unavailable");
        clearTimeout(lookupTimer);
        lookupController = null;
        publish(value);
        render(`Sharing location: ${Object.values(value).filter(Boolean).join(", ")}`, true);
      } catch {
        if (attempt === generation) fail();
      }
    }, (error) => {
      if (attempt === generation) fail(error.code === 1);
    }, { maximumAge: 0, timeout: 10000, enableHighAccuracy: false });
  }

  async function restore() {
    const attempt = generation;
    try {
      const permission = await navigator.permissions?.query({ name: "geolocation" });
      permission?.addEventListener("change", () => {
        if (permission.state !== "granted") stopSharing();
      });
      if (attempt !== generation || !preference()) return;
      if (permission?.state === "granted") start();
      else if (permission?.state === "denied") stopSharing();
    } catch {
      // Never request browser permission automatically when its state is unknown.
    }
  }

  function setup() {
    if (elements) return;
    const ids = ["shareLocation", "stopSharingLocation", "locationSharingStatus", "locationConsent", "allowLocation", "declineLocation"];
    const nodes = ids.map((id) => document.getElementById(id));
    if (nodes.some((node) => !node)) return;
    const [share, stop, status, consent, allow, decline] = nodes;
    elements = { share, stop, status, consent };
    render("Location sharing is off.");
    share.addEventListener("click", () => consent.showModal());
    stop.addEventListener("click", stopSharing);
    decline.addEventListener("click", () => {
      consent.close();
      stopSharing();
    });
    window.addEventListener("storage", (event) => {
      if (event.storageArea === localStorage &&
          (event.key === null || (event.key === PREFERENCE && event.newValue !== "yes"))) {
        stopSharing();
      }
    });
    allow.addEventListener("click", () => {
      consent.close();
      start();
    });
    restore();
    let seen = false;
    try {
      seen = localStorage.getItem(INVITATION) === "yes";
      localStorage.setItem(INVITATION, "yes");
    } catch {
      // Without storage, the invitation can only be remembered for this page.
    }
    if (!seen && !preference()) consent.showModal();
  }

  window.jeopardyLocation = { getLocation: () => ({ ...location }), setup };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
