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

The app reads the latest board from `data/latest-game.json`. Runtime browser code does not scrape J-Archive or call a CORS proxy.

To refresh the data source, run:

```sh
npm run update:data
```

That script opens J-Archive with Playwright from Node, follows the latest-season/latest-episode path, skips episodes that do not yet have a first-round table, transforms the first round into JSON, and writes `data/latest-game.json`.

## What we want

* I want a static HTML website which fetches the relevant Jeopardy data for the most recent episode, formats it as JSON, and renders the the retrieved questions and answers in the classic Jeopardy grid.
* The color scheme must match what is displayed on the Jeopardy TV show for the contestants; it does not have to match the source website.
* The visible app title should be generic, such as `Standup Jeopardy`. Do not use official Jeopardy logos or imply affiliation.
* Selecting a dollar-value tile should open a full-screen clue view showing only the clue text. Clicking the clue view should reveal the correct response.
* Opening a clue should use a smooth transition that expands from the clicked tile into the full-screen clue view. Closing the clue view should use a matching reverse transition back toward the clicked tile.
* Revealing the correct response should fade the response into view smoothly.
* The app should not enforce answering in Jeopardy form.
* The app should track whether each revealed clue was answered correctly.
* This is team Jeopardy: the whole team's "brain trust" answers together. Do not track scores, turns, or correctness by player.
* Daily Doubles should not receive special behavior. Render and score them like normal clues.
* After revealing a clue's response, the app should show two large controls: Correct and Missed. Selecting either option should return to the board and mark the tile with the selected outcome.
* Before a clue's response is revealed, provide a small close control that returns to the board without marking the tile used.
* Used tiles should remain visible but muted, with a green/red outcome indicator for correct or missed clues.
* Used tiles should not be reopenable or editable after they are marked Correct or Missed.
* Undoing or changing a Correct/Missed choice is out of scope for the MVP.
* Show a simple team tally in the header with correct count, missed count, and net Jeopardy dollar value.
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
* Do not depend on external libraries, fonts, scripts, stylesheets, or other CDN resources. Use plain HTML, CSS, and JavaScript browser APIs only.
* The data generator should fetch and render only the most recent archived episode with a first-round table. Do not add an episode picker or other browsing functionality.
* The MVP should render only the first round from the generated data. Do not include Double Jeopardy, Final Jeopardy, or round navigation.
* Used tile state only needs to live in memory for the current page session. Do not persist board state across refreshes.

## Deployment

* The site is published with GitHub Pages from the root-level `index.html` file.
* The GitHub Actions workflow at `.github/workflows/pages.yml` runs the Playwright test suite with `npm test` before deployment.
* Deployment is gated on passing tests: the Pages artifact is packaged and deployed only after the Playwright job succeeds.
* The workflow runs on pushes to `main`, can be run manually with `workflow_dispatch`, and runs daily at 13:00 UTC, which is 8:00 AM EST.
* The package job refreshes `data/latest-game.json` with `npm run update:data` before uploading the Pages artifact.
* GitHub Pages should be configured to use GitHub Actions as its source.

## Gotchas

* Any links to resources external to the page will 404, so these should always be excluded.
