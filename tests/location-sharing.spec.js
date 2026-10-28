const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:4173/location-fixture";
const KEY = "standup-jeopardy-location-sharing";
const EMPTY = { city: null, region: null, country: null };
const PLACE = { city: "State College", region: "Pennsylvania", country: "United States" };

async function fixture(page, options = {}) {
  await page.addInitScript(({ preference, permission = "prompt", unsupported, permissionsUnavailable, delayPermission }) => {
    if (preference) localStorage.setItem("standup-jeopardy-location-sharing", "yes");
    const status = new EventTarget();
    status.state = permission;
    window.browserLocation = {
      calls: 0,
      requests: [],
      revoke(state = "denied") {
        status.state = state;
        status.dispatchEvent(new Event("change"));
      },
      succeed(index = 0) {
        this.requests[index].success({ coords: { latitude: 40.8, longitude: -77.9 } });
      },
      deny() { this.requests.at(-1).error({ code: 1 }); }
    };
    Object.defineProperty(navigator, "permissions", { value: permissionsUnavailable ? undefined : {
      query: () => delayPermission ? new Promise((resolve) => {
        window.restorePermission = () => resolve(status);
      }) : Promise.resolve(status)
    } });
    Object.defineProperty(navigator, "geolocation", { value: unsupported ? undefined : {
      getCurrentPosition(success, error, options) {
        window.browserLocation.calls++;
        window.browserLocation.requests.push({ success, error, options });
      }
    } });
    window.locationEvents = [];
    window.addEventListener("jeopardy-location-change", (event) => window.locationEvents.push(event.detail));
  }, options);
  const requests = [];
  await page.route("https://api.bigdatacloud.net/**", async (route) => {
    requests.push(route.request());
    if (options.provider) return options.provider(route);
    return route.fulfill({ json: {
      city: PLACE.city, principalSubdivision: PLACE.region, countryName: PLACE.country
    } });
  });
  await page.route(URL, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
    <button id="shareLocation">Share location</button>
    <button id="stopSharingLocation" hidden>Stop sharing location</button>
    <span id="locationSharingStatus" aria-live="polite"></span>
    <dialog id="locationConsent"><p>Share your location with BigDataCloud?</p>
      <button id="allowLocation">Allow</button><button id="declineLocation">Decline</button>
    </dialog><script src="/location-sharing.js"></script>` }));
  await page.goto(URL);
  return requests;
}

const location = (page) => page.evaluate(() => window.jeopardyLocation.getLocation());
const calls = (page) => page.evaluate(() => window.browserLocation.calls);
async function allow(page) {
  await page.locator("#shareLocation").click();
  await page.locator("#allowLocation").click();
}

test("only explicit Allow gets current coordinates and shares an in-memory place", async ({ page }) => {
  const requests = await fixture(page);
  await expect.poll(() => location(page)).toEqual(EMPTY);
  await page.locator("#shareLocation").click();
  await expect(page.locator("#locationConsent")).toBeVisible();
  expect(await calls(page)).toBe(0);
  await page.locator("#allowLocation").click();
  await expect(page.locator("#stopSharingLocation")).toBeVisible();
  await page.evaluate(() => window.browserLocation.succeed());
  await expect.poll(() => location(page)).toEqual(PLACE);
  expect(requests).toHaveLength(1);
  expect(requests[0].url()).toBe("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=40.8&longitude=-77.9&localityLanguage=en");
  expect(await requests[0].headerValue("referer")).toBeNull();
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({ [KEY]: "yes" });
  expect(await page.evaluate(() => window.browserLocation.requests[0].options.maximumAge)).toBe(0);
  await expect(page.locator("#locationSharingStatus")).toContainText("State College");
  expect(await page.evaluate(() => window.locationEvents.at(-1))).toEqual(PLACE);
});

test("declining consent never requests browser location or provider lookup", async ({ page }) => {
  const requests = await fixture(page);
  await page.locator("#shareLocation").click();
  await page.locator("#declineLocation").click();
  await expect(page.locator("#locationConsent")).not.toBeVisible();
  expect(await calls(page)).toBe(0);
  expect(requests).toHaveLength(0);
  expect(await location(page)).toEqual(EMPTY);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test("Stop during browser lookup ignores late coordinates and allows a fresh attempt", async ({ page }) => {
  const requests = await fixture(page);
  await allow(page);
  await page.locator("#stopSharingLocation").click();
  await expect(page.locator("#shareLocation")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await allow(page);
  await page.evaluate(() => window.browserLocation.succeed(0));
  expect(await location(page)).toEqual(EMPTY);
  expect(requests).toHaveLength(0);
  await page.evaluate(() => window.browserLocation.succeed(1));
  await expect.poll(() => location(page)).toEqual(PLACE);
  await page.locator("#stopSharingLocation").click();
  expect(await location(page)).toEqual(EMPTY);
  expect(await page.evaluate(() => window.locationEvents.at(-1))).toEqual(EMPTY);
});

test("Stop aborts an outstanding provider request and late results stay inactive", async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch;
    window.providerAborts = 0;
    window.fetch = (url, options) => {
      options.signal?.addEventListener("abort", () => window.providerAborts++);
      return fetch(url, options);
    };
  });
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const requests = await fixture(page, { provider: async (route) => {
    await waiting;
    await route.fulfill({ json: { city: "Late city" } }).catch(() => {});
  } });
  await allow(page);
  await page.evaluate(() => window.browserLocation.succeed());
  await expect.poll(() => requests.length).toBe(1);
  await page.locator("#stopSharingLocation").click();
  release();
  await expect.poll(() => page.evaluate(() => window.providerAborts)).toBe(1);
  expect(await location(page)).toEqual(EMPTY);
  await expect(page.locator("#shareLocation")).toBeVisible();
});

for (const permission of ["granted", "prompt", "denied", "unavailable"]) {
  test(`reload with opt-in and ${permission} permission never prompts`, async ({ page }) => {
    const requests = await fixture(page, {
      preference: true, permission, permissionsUnavailable: permission === "unavailable"
    });
    await page.reload();
    await expect(page.locator("#locationConsent")).not.toBeVisible();
    if (permission === "granted") {
      await expect.poll(() => calls(page)).toBe(1);
      expect(await location(page)).toEqual(EMPTY);
      await page.evaluate(() => window.browserLocation.succeed());
      await expect.poll(() => location(page)).toEqual(PLACE);
    } else {
      expect(await calls(page)).toBe(0);
      expect(requests).toHaveLength(0);
      expect(await location(page)).toEqual(EMPTY);
      await expect(page.locator("#shareLocation")).toBeVisible();
      if (permission === "denied") {
        expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
      }
    }
  });
}

for (const state of ["prompt", "denied"]) {
  test(`permission revocation to ${state} clears sharing and ignores late coordinates`, async ({ page }) => {
    const requests = await fixture(page);
    await allow(page);
    await page.evaluate(() => window.browserLocation.succeed());
    await expect.poll(() => location(page)).toEqual(PLACE);
    await page.evaluate((state) => window.browserLocation.revoke(state), state);
    await expect.poll(() => location(page)).toEqual(EMPTY);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
    await expect(page.locator("#shareLocation")).toBeVisible();
    await allow(page);
    await page.evaluate((state) => window.browserLocation.revoke(state), state);
    await page.evaluate(() => window.browserLocation.succeed(1));
    expect(await location(page)).toEqual(EMPTY);
    expect(requests).toHaveLength(1);
  });
}

for (const failure of ["denied", "unsupported", "provider", "empty"]) {
  test(`${failure} leaves location empty with manual retry and no fallback`, async ({ page }) => {
    const requests = await fixture(page, {
      unsupported: failure === "unsupported",
      provider: failure === "provider" ? (route) => route.fulfill({ status: 503, body: "Unavailable" }) :
        failure === "empty" ? (route) => route.fulfill({ json: {} }) : undefined
    });
    await allow(page);
    if (failure === "denied") await page.evaluate(() => window.browserLocation.deny());
    else if (failure !== "unsupported") await page.evaluate(() => window.browserLocation.succeed());
    await expect(page.locator("#locationSharingStatus")).toContainText("try again");
    expect(await location(page)).toEqual(EMPTY);
    await expect(page.locator("#shareLocation")).toBeVisible();
    expect(requests).toHaveLength(["provider", "empty"].includes(failure) ? 1 : 0);
    if (["denied", "unsupported"].includes(failure)) {
      expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
    }
  });
}

test("provider timeout clears pending sharing and permits explicit retry", async ({ page }) => {
  await page.clock.install();
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const requests = await fixture(page, { provider: async (route) => {
    await waiting;
    await route.fulfill({ json: { city: "Late city" } }).catch(() => {});
  } });
  await allow(page);
  await page.evaluate(() => window.browserLocation.succeed());
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.fastForward(10001);
  try {
    await expect(page.locator("#locationSharingStatus")).toContainText("try again");
    expect(await location(page)).toEqual(EMPTY);
    await expect(page.locator("#shareLocation")).toBeVisible();
    expect(await calls(page)).toBe(1);
  } finally {
    release();
  }
});

for (const key of [KEY, null]) {
  test(`storage removal (${key || "clear"}) cancels sharing across tabs`, async ({ page }) => {
    const requests = await fixture(page);
    await allow(page);
    await page.evaluate(() => window.browserLocation.succeed());
    await expect.poll(() => location(page)).toEqual(PLACE);
    const clearFromOtherTab = () => page.evaluate((key) => {
      if (key === null) localStorage.clear();
      else localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: null, storageArea: localStorage }));
    }, key);
    await clearFromOtherTab();
    expect(await location(page)).toEqual(EMPTY);
    await expect(page.locator("#shareLocation")).toBeVisible();
    await allow(page);
    await clearFromOtherTab();
    await page.evaluate(() => window.browserLocation.succeed(1));
    expect(await location(page)).toEqual(EMPTY);
    expect(requests).toHaveLength(1);
  });
}

test("provider names are cleaned and limited to 120 characters before publishing", async ({ page }) => {
  await fixture(page, { provider: (route) => route.fulfill({ json: {
    city: "  A\u0000\nB\u007fC  ", principalSubdivision: "R".repeat(121), countryName: 42
  } }) });
  await allow(page);
  await page.evaluate(() => window.browserLocation.succeed());
  await expect.poll(() => location(page)).toEqual({ city: "ABC", region: "R".repeat(120), country: null });
});

test("Decline cancels a granted restore that starts while consent is open", async ({ page }) => {
  await fixture(page, { preference: true, permission: "granted", delayPermission: true });
  await page.locator("#shareLocation").click();
  await page.evaluate(() => window.restorePermission());
  await expect.poll(() => calls(page)).toBe(1);
  await page.locator("#declineLocation").click();
  await page.evaluate(() => window.browserLocation.succeed());
  expect(await location(page)).toEqual(EMPTY);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test("provider timeout also covers a stalled JSON body", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.jsonStarted = false;
    window.fetch = async () => ({
      ok: true,
      json: () => {
        window.jsonStarted = true;
        return new Promise((resolve) => { window.finishJson = () => resolve({ city: "Too late" }); });
      }
    });
  });
  await fixture(page);
  await allow(page);
  await page.evaluate(() => window.browserLocation.succeed());
  await expect.poll(() => page.evaluate(() => window.jsonStarted)).toBe(true);
  await page.clock.fastForward(10001);
  await expect(page.locator("#locationSharingStatus")).toContainText("try again");
  await page.evaluate(() => window.finishJson());
  expect(await location(page)).toEqual(EMPTY);
  await expect(page.locator("#shareLocation")).toBeVisible();
});
