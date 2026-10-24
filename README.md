# Bryan’s Arcade

Open `index.html` in a browser for the game-selection grid. Each game has an illustrated scene. Ghost Pop and Dad Dug are playable; Eviction and Pac-Bryan are marked Coming soon. Filter the grid by availability. The pages are self-contained; no build, server, or downloaded assets are required.

## Dad Dug

Open `dad-dug.html`, or choose Dad Dug from the arcade. Dig tunnels, face Inky or Blinky, and hold the pump for four inflation hits. Both ghosts flash blue and white and grow while inflated; they stop moving and gradually deflate if you stop pumping. The hose reaches three tiles through open tunnels and cannot pass through dirt or rocks. Its tip extends at 120 board units per second, taking about 0.87 seconds to reach full range. Only the advancing tip can attach to a ghost; the hose behind it cannot. Once attached, holding Pump adds inflation every 0.27 seconds. Misses retract over 0.16 seconds, cannot catch ghosts on the return trip, and retry after a short recovery while Pump stays held. Releasing Pump or turning cancels the current extension. Ghosts follow tunnels and periodically phase through dirt, becoming unpumpable until they return to a tunnel. Ghost movement is 20% faster than the original pace, including phasing and later-round speed increases. Inky warns with an exclamation mark before breathing icy fire down a tunnel.

Move with arrows or WASD; hold Space or X to pump in the direction you face. Hold a direction while pumping to turn in place. On touchscreens, hold the on-screen D-pad and Pump buttons, including together. A standard gamepad uses the left stick or D-pad to move and the south face button or right trigger to pump. South selects on the start, pause, and game-over screens; Start/Options toggles pause. Release controller buttons and sticks after changing screens or returning to the page. Keyboard P/Escape or the Pause button also pauses; leaving the page pauses automatically. New game is available while paused. Sound is optional and starts off.

Dig underneath a rock to release it after a short wobble, then step aside. Rock kills earn 1,000 points for the first ghost and 2,000 for each additional ghost under the same rock. Pump kills earn 200–500 points according to depth. The second rock drop reveals a carrot worth 500 points for 12 seconds. Clear every ghost to earn a round bonus and advance; later rounds add ghosts and increase their speed. Start with three lives and earn another every 10,000 points. A lost life keeps the excavated tunnels and surviving ghosts. The local best score uses `dadDug.best.v1`; storage restrictions leave the game playable with a session-only best.

## Ghost Pop

Open `ghost-pop.html` in a browser, or choose Ghost Pop from the arcade. The game is self-contained; no build or server is required. The Other Games link returns to `index.html`.

Classic uses 6 colors, 18 columns, 20 rows, and 7 starting rows. Every 5 non-popping shots adds 2 rows. Popping ghosts preserves that counter. At the last chance, the next-color preview becomes a row warning; eliminated colors cannot return through the queue or row waves.

Easy inherits Classic with 5 colors and 7 non-popping shots per two-row wave. Super-Easy inherits Classic with 4 colors and 7 non-popping shots per one-row wave. Each built-in mode has its own local top 10 scores.

Drag and release to shoot with touch or the left mouse button. Right/middle clicks do not shoot. Arrow keys aim and Space/Enter fires during play; form controls keep their usual keyboard behavior. Arrow presses turn 0.025 radians; holding repeats after 100 ms, turning 0.015 radians every 25 ms independently of the operating system's repeat settings. `AIM_INPUT` controls these values. Classic has a 340-unit aim guide with one previewed wall bounce and slightly forgiving collision detection. Actual shots have unlimited wall bounces. The Custom Mode bounce setting applies only to the guide. The next shot is shown immediately to the right of the launcher, including the last-chance row warning.

Gamepads use the browser's [standard gamepad mapping](https://w3c.github.io/gamepad/#remapping). Connect a controller and press a button so the browser can detect it. Either stick points the aim into the upper firing arc; downward stick directions are mirrored upward. A radial deadzone prevents drift. Either trigger or the south face button (Xbox A, Switch B, PlayStation X) shoots once per press, without automatic firing when held through a landing or pop animation. `GAMEPAD_INPUT` controls the deadzone, trigger threshold, and navigation repeat timing.

The D-pad moves between menu buttons and settings controls; south selects, east goes back, and Start/Options opens or closes settings during a game. Left/right adjusts the focused speed selector. Custom numeric settings and high-score names still use keyboard/touch input. Controller presses are suppressed while the page is unfocused; release held buttons after returning. Mouse, touch, and keyboard remain available when the Gamepad API is unavailable.

Matches pop as a chain reaction along same-color connections, starting with the landed shot and advancing one adjacency layer every 85 ms (`REACTION_INTERVAL`). Detached ghosts disappear after the matching waves finish; points, queue changes, and win/loss checks resolve once at the end. Another shot cannot launch during a chain. Restarting or returning to the menu cancels the pending animation.

The pop-count prefix appears only when total removed ghosts exceed the active `matchSize`. Matched-ghost chain bonuses begin only for matches larger than that configured minimum: `1 + max(0, matched - matchSize) * chainBonus`. Falling ghosts retain their separate `dropPoints` reward.

Final scores use `points / shots^1.5` on a loss and `(points * 100) / shots^1.5` on a win. Fewer shots improve the final score for the same points and result. The top 10 completed games for each built-in mode are saved on this browser. Qualifying results include an inline name field; unnamed scores display Anonymous. Custom Mode saves preferences and does not record scores.

Settings are available from the menu and during play. Colorblind mode is off by default; enabling it adds large, centered color numbers to ghosts, shots, and the next-shot preview. Color assist is also off by default. When enabled, current-shot matches pulse dark blue for 0.7 seconds and white for 0.3 seconds, next-shot matches are cyan (except at the last chance), and other ghosts are orange. The current color takes priority when current and next match. Assist tracks the projectile color during flight.

Game speed defaults to Fast: shots travel at 845 board units/second (30% faster than the original 650), with the original mouth-animation rate. Slow travels at 455 units/second (30% slower), with half-speed mouth animation. The assist pulse always uses real time. Opening Settings pauses the game until the dialog closes.

## Changing rules

The script's `CLASSIC` object is the default rule set; `MODES` supplies each mode's name, rules, and leaderboard policy. Starting a game copies the selected rules into `rules`, and geometry, matching, scoring, aiming, collisions, and row waves read those values. `FIELDS` defines Custom Mode controls and validation bounds. Custom defaults come directly from Classic. Custom supports 1–36 ghost colors, 4–48 columns, 6–60 rows, up to 100 preview bounces, and a guide up to 10,000 units. Starting rows must leave two empty rows and a row wave must be smaller than the grid.

Every Randomize colors button samples each color independently from the full RGB range, without hue-spacing constraints. Close or identical colors are permitted and persist as chosen. Default colors restores a preset palette, including green `#19864b` in Classic. Display settings do not change the underlying color IDs or matching rules.

LocalStorage keys are `pacGhostPop.custom.v1`, `pacGhostPop.palettes.v1`, `pacGhostPop.scores.v1`, and `pacGhostPop.settings.v1`. They persist across browser restarts under the same origin/browser profile. Clearing browser data removes them. Browser restrictions on local files/private sessions may prevent persistence; the game displays a notice and remains playable. Keep the file at the same path when playing directly from disk.

## Verification

The browser tests require Node.js and Playwright (`npm install --no-save --package-lock=false playwright`). They use installed Microsoft Edge on Windows; elsewhere, install Playwright's Chromium with `npx playwright install chromium`. A custom browser executable can be supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Run `node --test tests/ghost-pop.test.cjs`. The 23 tests cover touch hold/drag/release/cancel, mouse buttons, keyboard controls and repeat timing, simulated gamepad sticks/buttons/triggers/menu navigation/disconnects/focus loss, settings persistence, optional numbers, speed/animation rates, assist colors and timing, expanded Custom ranges, independent random colors, connection-based chain reactions, configurable combo thresholds, matching and scoring, row waves and color elimination, guide-only wall limits, named high scores, Easy/Super-Easy rules and separate leaderboards, launcher-side previews, and desktop/portrait/landscape layouts. Screenshots are written to `.test-artifacts/`. Tests use isolated browser contexts and do not touch the player's saved data.

Run `node --test tests/dad-dug.test.cjs` for Dad Dug, or `node --test tests/*.test.cjs` for both games. Dad Dug tests cover arcade links and filters, tunnel excavation and obstacles, directional pumping and actual blue/white rendered pixels, inflation recovery, falling-rock combos and snacks, ghost pursuit and phasing, Inky’s breath, contact damage, lives, round progression, pause/focus behavior, touch and controller input, best-score persistence and storage failures, live responsive layouts, and direct-file play. Screenshots also go to `.test-artifacts/`.
