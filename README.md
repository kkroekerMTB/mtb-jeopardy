# Jeopardy! For Minitab standups.

## Overview

Every day at standup, we close our time by playing some Jeopardy. We open up the Jeopardy archive website at [j-archive.com](https://www.j-archive.com/) and waste precious time clicking around to find the most recent season and the most recent episode. The website looks like it was built before the dotcom bubble burst, so it's time to slap a new, customized front-end on the valuable data with its questions and answers.

## Step by Step for getting to the data:

* Go to `https://www.j-archive.com/`. This brings you to the home page.
* Click the list item at the `body > table > tbody > tr > td > p:nth-child(3) > a:last-child` CSS selector in the DOM. This brings you to the list of recent episodes, which are sorted descending.
* Click the topmost episode at the `#content > table > tbody > tr:nth-child(1) > td:first-child > a` CSS selector in the DOM. This brings you to the most recent episode.
* The CSS selector `table.round` returns the rendered `<table>` containing the Jeopardy questions and answers.
* The relevant structure of the table is as follows:
    - The first `tr` contains the table headers with question categories. Each category is contained in `td.category`.
    - The rest of the `tr` rows contain the questions and answers. Each question is contained in `td.clue`.
        * Each clue contains a sub-table with the following structure:
            - `td.clue_value` contains the dollar value for the question (e.g. $200)
            - `td.clue_text` contains the question (e.g. "A mass of cytoplasm bound by a membrane, it's the smallest independently functioning unit of living matter")
            - `em.correct_response` contains the correct answer (e.g. "a cell") and is hidden by default.
* The above defines the data points we care about for the purposes of standup.

## Data generation

The app reads the latest board from `data/latest-game.json`. Runtime browser code does not scrape J-Archive or call a CORS proxy. The generated data identifies exactly one first-round Daily Double using the source episode's marker. If that marker is missing, ambiguous, or belongs to an unrenderable clue, generation selects a deterministic playable fallback for that episode.

To refresh the data source, run:

```sh
npm run update:data
```

That script opens J-Archive with Playwright from Node, follows the latest-season/latest-episode path, skips episodes that do not yet have a first-round table, and writes `data/latest-game.json`. Before selecting an episode, it reads the distinct source episodes used before the current `America/New_York` calendar day from the leaderboard API.

If the newest playable episode was already used or cannot be loaded, generation selects an unused episode from seasons 1–40. Fallback selection is deterministic for the calendar day and gives every enumerated episode equal weight. A published board is reused for the rest of its selection day so pushes and manual deployments cannot change the episode during the workday.

Local generation uses the production source-episode API by default. Override it with `SCORES_API_URL`. Set `CURRENT_GAME_DATA_URL` to enable the published-board day lock; the Pages workflow sets this automatically, while ordinary local runs remain unlocked.

## What we want

* I want a static HTML website which fetches the relevant Jeopardy data for the most recent episode, formats it as JSON, and renders the the retrieved questions and answers in the classic Jeopardy grid.
* The color scheme must match what is displayed on the Jeopardy TV show for the contestants; it does not have to match the source website.
* The visible app title should be generic, such as `Standup Jeopardy`. Do not use official Jeopardy logos or imply affiliation.
* Play the theme song once when the app loads. Show an on-by-default Theme music setting and persist its value in local storage.
* Selecting a dollar-value tile should open a full-screen clue view showing only the clue text. Clicking the clue view should reveal the correct response.
* Opening a clue should use a smooth transition that expands from the clicked tile into the full-screen clue view. Closing the clue view should use a matching reverse transition back toward the clicked tile.
* Revealing the correct response should fade the response into view smoothly.
* The app should not enforce answering in Jeopardy form.
* The app should track whether each revealed clue was answered correctly.
* This is team Jeopardy: the whole team's "brain trust" answers together. Do not track scores, turns, or correctness by player.
* The first round should contain exactly one Daily Double at the same board position as the source episode whenever that clue can be rendered.
* Do not visually distinguish the Daily Double tile before it is selected. Because the source does not assign it an ordinary clue value, show the value inferred from the other clues in its row as display text only.
* If the source Daily Double is unavailable, missing, or ambiguous, choose a playable fallback deterministically from the episode URL and eligible clue IDs. Repeated generation of the same episode must produce the same fallback.
* Opening the Daily Double should expand it from the selected tile into a red full-screen card while it rotates forward five times over approximately 1.2 seconds. Under reduced-motion preferences, use a short fade/scale entrance without rotation.
* Play the Daily Double sound effect when the Daily Double card appears.
* Keep the Daily Double clue hidden until the team locks a whole-dollar wager. Show the current score and wager range while wagering.
* A Daily Double wager must be between $5 and the greater of the current score or $1,000. Default to the current score when it is at least $5; otherwise default to $5.
* Hide the close control for a Daily Double and require the team to mark it Correct or Missed. Once locked, show the wager in place of the clue value. Identify an all-in positive-score wager as a True Daily Double.
* Score Daily Doubles using the wager rather than the display-only row value. Add it for Correct and subtract it for Missed, while still incrementing the corresponding answer count.
* After revealing a clue's response, the app should show two large controls: Correct and Missed. Selecting either option should return to the board and mark the tile with the selected outcome.
* Before a normal clue's response is revealed, provide a small close control that returns to the board without marking the tile used.
* Used normal tiles should remain visible but muted, with a green/red outcome indicator for correct or missed clues. A used Daily Double tile should remain red and display `DD` with its signed score contribution.
* Used tiles should not be reopenable or editable after they are marked Correct or Missed.
* Undoing or changing a Correct/Missed choice is out of scope for the MVP.
* Show a simple team tally in the header with correct count, missed count, and net Jeopardy dollar value. A Daily Double contributes its signed wager to the net value.
* Score submissions should include a signed numeric `daily_double_amount` property. Use zero when the Daily Double was not answered.
* Limit each submitted score to the first six answered clues in chronological order while continuing to show all answers in the gameplay tally. Load the maximum from the shared game rules configuration so it can be changed later.
* Disable score submission until at least one clue is answered. Show the number of included questions on the submit button, cap it at the configured maximum, and identify excluded later answers in the confirmation.
* Enforce the configured question-count range in the score API and store the active `question_limit` on each new score record.
* The leaderboard should roll up `daily_double_amount` across the selected time window, treat legacy rows without the property as zero, and show the signed result in a `DD Amount` column after Score. Continue ranking by total Score.
* Do not include a New Game or Reload Latest control. Browser refresh is sufficient.
* Show the scraped episode title/date in the header when available, but do not block board rendering if that metadata is missing.
* Show a small source link to the loaded J-Archive episode in the header or footer. This should be a normal user-initiated link, not an external asset dependency.
* The team should manually select tiles from the board. Do not randomize clue selection or automatically choose the next clue.
* Normalize scraped category, clue, and response content for presentation: convert scraped HTML to plain text only, clean up whitespace, and render text clearly while preserving the original meaning. Strip or ignore external links, images, audio, video, formatting tags, and other resources.
* Show correct responses exactly as scraped after plain-text cleanup. Do not normalize casing, leading articles, aliases, or wording.
* Media-dependent clues are unsupported in the MVP. Do not render media placeholders or attempt to recover stripped image/audio/video content. If a clue contains detected image, audio, or video content, disable that tile automatically.
* Use scraped clue values exactly as provided by J-Archive. Do not infer fallback dollar values from row position.
* If some clues fail to parse, still render the board. Missing or malformed clue tiles should be disabled and labeled `N/A`, and the header should show a small warning count.
* Disabled tiles should only contribute to the header warning count. Do not include disabled tiles in correct/missed totals or net value.
* Use one combined unavailable warning count for disabled tiles; do not distinguish malformed clues from unsupported media clues in the UI.
* Preserve the scraped board shape even if a category has no playable clues. Render the category with all unavailable tiles disabled.
* If the latest episode cannot be found or loaded, show a terse visible failure message such as `Couldn't load latest game` and log technical details to the browser dev console.
* Show a simple loading state while fetching and parsing the latest game. Any loading animation must be implemented with inline HTML/CSS and must not rely on an external image file.
* Keyboard shortcuts are out of scope for the MVP.
* Optimize the UI for desktop screen sharing, with a reasonable responsive fallback for laptop-sized widths. Phone-optimized play is out of scope for the MVP.

## Architecture Notes

* The website should be a static HTML website with local generated JSON data.
* The static entrypoint should be a root-level `index.html` file.
* The browser should read `data/latest-game.json` from the same origin as the page. It should not make runtime requests to J-Archive or public CORS proxies.
* Do not embed sample episode payloads in the static page.
* Do not load libraries, fonts, scripts, stylesheets, or other assets from external CDNs. Keep the gameplay UI in plain HTML, CSS, and JavaScript; the Application Insights browser SDK is the only third-party runtime library and must be self-hosted in the Pages artifact.
* The data generator should prefer the most recent archived episode with a first-round table, then fall back to an unused episode from season 40 or earlier. Do not add an episode picker or other browsing functionality.
* The MVP should render only the first round from the generated data. Do not include Double Jeopardy, Final Jeopardy, or round navigation.
* Used tile state only needs to live in memory for the current page session. Do not persist board state across refreshes.

## Deployment

* The site is published with GitHub Pages from the root-level `index.html` file.
* The GitHub Actions workflow at `.github/workflows/pages.yml` runs the Playwright test suite with `npm test` before deployment.
* Deployment is gated on passing tests: the Pages artifact is packaged and deployed only after the Playwright job succeeds.
* The workflow runs on pushes to `main`, can be run manually with `workflow_dispatch`, and runs daily at 05:17 UTC.
* The package job configures the current Pages URL, refreshes `data/latest-game.json` with `npm run update:data`, and then uploads the Pages artifact.
* GitHub Pages should be configured to use GitHub Actions as its source.

## Application Insights telemetry

Telemetry is disabled when its connection string is not configured. To enable both sides of the app:

* Set the Azure App Service application setting `APPLICATIONINSIGHTS_CONNECTION_STRING` to the backend Application Insights connection string. The server uses the Azure Monitor OpenTelemetry distro and reports HTTP requests, Azure SDK dependencies, failures, and runtime metrics with the default service name `mtb-jeopardy-api`. Set `OTEL_SERVICE_NAME` to override that name.
* Add a GitHub Actions repository variable named `APPLICATIONINSIGHTS_WEB_CONNECTION_STRING` for the Pages deployment. The build writes this value into the public static artifact and self-hosts the Application Insights browser SDK. Application Insights browser connection strings identify the ingestion resource and are expected to be visible to browsers; they are not secrets.

The browser reports page views, fetch dependencies, uncaught errors, handled loading/submission failures, and the `board_loaded`, `clue_answered`, and `score_submitted` events under the `mtb-jeopardy-web` cloud role. Custom events omit the team name, clue text, and response text.

The frontend and backend can report to the same Application Insights resource because their role names distinguish them. If App Service codeless Application Insights monitoring is already enabled, disable it before using the code-based backend instrumentation to avoid competing instrumentation paths.

For a configured local static build, run:

```sh
APPLICATIONINSIGHTS_WEB_CONNECTION_STRING='InstrumentationKey=...' npm run build:site
```

## Gotchas

* Any links to resources external to the page will 404, so these should always be excluded.
