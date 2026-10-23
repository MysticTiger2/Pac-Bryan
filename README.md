# Pac-Ghost Pop

Open `pac-ghost-pop.html` in a browser. The game is self-contained; no build or server is required. The Other Games link points to the future `index.html`.

Classic uses 6 colors, 18 columns, 20 rows, and 7 starting rows. Every 5 non-popping shots adds 2 rows. Popping ghosts preserves that counter. At the last chance, the next-color preview becomes a row warning; eliminated colors cannot return through the queue or row waves.

Easy inherits Classic with 5 colors and 7 non-popping shots per two-row wave. Super-Easy inherits Classic with 4 colors and 7 non-popping shots per one-row wave. Each built-in mode has its own local top 10 scores.

Drag and release to shoot with touch or the left mouse button. Right/middle clicks do not shoot. Arrow keys aim and Space/Enter fires during play; form controls keep their usual keyboard behavior. Arrow presses turn 0.025 radians; holding repeats after 100 ms, turning 0.015 radians every 25 ms independently of the operating system's repeat settings. `AIM_INPUT` controls these values. Classic has a 340-unit aim guide with one previewed wall bounce and slightly forgiving collision detection. Actual shots have unlimited wall bounces. The Custom Mode bounce setting applies only to the guide. The next shot is shown immediately to the right of the launcher, including the last-chance row warning.

Matches pop as a chain reaction along same-color connections, starting with the landed shot and advancing one adjacency layer every 85 ms (`REACTION_INTERVAL`). Detached ghosts disappear after the matching waves finish; points, queue changes, and win/loss checks resolve once at the end. Another shot cannot launch during a chain. Restarting or returning to the menu cancels the pending animation.

Final scores use `points / shots^1.5` on a loss and `(points * 100) / shots^1.5` on a win. Fewer shots improve the final score for the same points and result. The top 10 completed games for each built-in mode are saved on this browser. Qualifying results include an inline name field; unnamed scores display Anonymous. Custom Mode saves preferences and does not record scores.

Settings are available from the menu and during play. Colorblind mode is off by default; enabling it adds large, centered color numbers to ghosts, shots, and the next-shot preview. Color assist is also off by default. When enabled, current-shot matches pulse dark blue for 0.7 seconds and white for 0.3 seconds, next-shot matches are cyan (except at the last chance), and other ghosts are orange. The current color takes priority when current and next match. Assist tracks the projectile color during flight.

Game speed defaults to Fast: shots travel at 845 board units/second (30% faster than the original 650), with the original mouth-animation rate. Slow travels at 455 units/second (30% slower), with half-speed mouth animation. The assist pulse always uses real time. Opening Settings pauses the game until the dialog closes.

## Changing rules

The script's `CLASSIC` object is the default rule set; `MODES` supplies each mode's name, rules, and leaderboard policy. Starting a game copies the selected rules into `rules`, and geometry, matching, scoring, aiming, collisions, and row waves read those values. `FIELDS` defines Custom Mode controls and validation bounds. Custom defaults come directly from Classic. Custom supports 1–36 ghost colors, 4–48 columns, 6–60 rows, up to 100 preview bounces, and a guide up to 10,000 units. Starting rows must leave two empty rows and a row wave must be smaller than the grid.

Every Randomize colors button samples each color independently from the full RGB range, without hue-spacing constraints. Close or identical colors are permitted and persist as chosen. Default colors restores a preset palette, including green `#19864b` in Classic. Display settings do not change the underlying color IDs or matching rules.

LocalStorage keys are `pacGhostPop.custom.v1`, `pacGhostPop.palettes.v1`, `pacGhostPop.scores.v1`, and `pacGhostPop.settings.v1`. They persist across browser restarts under the same origin/browser profile. Clearing browser data removes them. Browser restrictions on local files/private sessions may prevent persistence; the game displays a notice and remains playable. Keep the file at the same path when playing directly from disk.

## Verification

The browser tests require Node.js and Playwright (`npm install --no-save --package-lock=false playwright`). They use installed Microsoft Edge on Windows; elsewhere, install Playwright's Chromium with `npx playwright install chromium`. A custom browser executable can be supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Run `node --test tests/pac-ghost-pop.test.cjs`. The 19 tests cover touch hold/drag/release/cancel, mouse buttons, keyboard controls and repeat timing, settings persistence, optional numbers, speed/animation rates, assist colors and timing, expanded Custom ranges, independent random colors, connection-based chain reactions, matching and scoring, row waves and color elimination, guide-only wall limits, named high scores, Easy/Super-Easy rules and separate leaderboards, launcher-side previews, and desktop/portrait/landscape layouts. Screenshots are written to `.test-artifacts/`. Tests use isolated browser contexts and do not touch the player's saved data.
