# Validation — 25 October 2026

## Version 1.1.1 finish-flow repair

- Live yt.cafe was checked read-only: its build marker and healthy API matched 1.1.0. The previous form was outside `#playfield`, so native fullscreen hid it. No remote changes were made from this build workspace.
- Score entry, posting feedback and Done are now within the fullscreen playfield. Pause/stage-clear menus support voluntary finishing; the replay validator handles the same finish command and calculates earned score.
- 27 Node test groups cover the engine, all three full-game replays, server API, voluntary finishes, invalid replays, persistent pending-score storage, queue limits, blocked storage, explicit ranked-start failure, visible practice/zero-score outcomes, posting retries and removal only after successful posting. A structural assertion ensures all result controls are inside the fullscreen element.
- 21 installer tests still pass. Static validation still covers seven HTML pages, 97 local references and both original inline app scripts.
- Browser test: a real ranked run earned $400, was voluntarily finished through Pause, saved through Done, recovered after page reload, then posted and replay-verified at rank #1 in isolated preview data. Production scores were not touched. The cloud browser rejected native fullscreen, so the transition itself could not be exercised there; containment is verified structurally and the visible in-game form was tested normally.

## Version 1.1.0 update

- All seven HTML pages include both top and bottom whispr.dev credits; original game and asset attributions remain.
- Site inspection: seven HTML pages, 97 local links/assets/fragments, two inline application scripts; JavaScript syntax checks pass.
- Leaderboard: five Node test groups, including complete 18-shift replay verification for each of the three modes; malformed/unfinished/over-limit replays; and real HTTP API tests for mode isolation, signed-ticket rejection, score derivation, single-use idempotent receipts, public-name validation, personal-best retention, nickname changes and persistence across service restart. Test keys, tickets and state use isolated temporary directories and never reach yt.cafe.
- Installer: 21 Python test groups pass, including the existing archive/configuration defenses and a new failed-backend-health rollback preserving the previous site, unit, enabled/running state and existing scores.
- The final deployment payload was extracted into a fresh temporary release: all file checksums matched, public and server files were separated, the backend started from the packaged release, and all three production boards were empty.
- Native `systemd-analyze verify` accepts the generated unit using this environment’s actual Node executable. Caddy/Nginx native validation still runs on NYC1 before deployment.
- Existing West Bank 13 engine test groups and Gold Rush 35 scenarios pass unchanged.
- Browser QA: the normal ranked-game flow completed with a real $600 result, which the API verified and displayed at rank #1 under “Preview test”. Difficulty tabs and both credits were inspected. A 390-pixel iframe preview had a 390-pixel body and scroll width (no page overflow); the results table scrolls within its own container. Test records remain only in temporary preview data and are not packaged.
- Node.js 24.22.1 was used for local tests; the service targets the documented built-in APIs of Node 22+. There are no production npm dependencies.

The previous release validation below remains useful for the unchanged maths/history, image assets and gold shader.


## Completed

- JavaScript syntax checks for homepage behavior, shared subpage controls, game modules, and both inline application scripts.
- Static inspection of all seven HTML documents, 97 local links/assets/fragments, stylesheet URLs and the locally bundled Three.js import map. No CDN runtime scripts, remote font stylesheets or hotlinked images remain.
- **Gold Rush:** 35 automated scenarios covering startup, checkout, all eleven events with/without supplies, lethal event damage, preservation of game-over screens and fresh expeditions after retry. Browser checks covered setup, purchasing and the trail screen with the local pixel font and compiled utility CSS.
- **West Bank:** 13 Node test groups, including twelve full deterministic runs across three modes and four seeds: 216 shifts and 648 duel opponents. Browser checks covered the embedded game, starting play and real deposit progress.
- **Installer:** 20 Python test groups covering Caddy/Nginx configuration parsing, host isolation, TLS/auth preservation, import handling, refusal of ambiguous/shared configurations, archive path/link/checksum defenses, successful release installation and rollback after a simulated reload failure. Transaction tests use temporary files and mocked service commands; they do not contact NYC1.
- **Gold shader:** compiled and linked using Mesa software OpenGL, with three rendered animation phases and a visible warm-gold surface. This validates shader structure/rendering outside the browser.
- **Browser:** homepage imagery/layout, mathematical ribbon drawing, edge-trace controls, source links opening the references, shared viewer route and the viewer's no-WebGL fallback. A 390-pixel iframe was used to inspect the narrow-screen homepage layout.

## Boundaries

- The cloud browser has no usable WebGL context. Hardware-accelerated interactive 3D was not exercised in that browser. The existing viewer controls and rendering loop are retained, with a visible still-image fallback and disabled motion controls if initialization fails.
- The remote browser throttles animation between tool interactions; it is not a human timing/playability benchmark. Actual touch latency, audio timbre and human difficulty balance remain device-dependent playtesting items.
- NYC1 was not reached: `ssh nyc1` failed because the build workspace has no configured SSH alias/address for it. No remote files, DNS records, Cloudflare settings or web-server configuration were changed.
- The actual NYC1 virtual-host layout, TLS configuration, OS permissions and reload behavior have not been inspected or validated. The installer checks these on the destination and stops on unsupported layouts. Native Caddy/Nginx validation happens there before reloading.
- PowerShell was unavailable in the build environment, so `Deploy.ps1` was reviewed but not executed. Its generated Python installer and payload validation/rollback paths were tested separately. After a real run stopped at `sudo: a password is required`, the SSH invocation was corrected to request a terminal (`ssh -t`) and allow the normal sudo password prompt; that interactive Windows/NYC1 path still requires verification there.

## Reproduce

```text
python3 checks/check_site.py
node --check dist/assets/home.js
node --check dist/assets/experience.js
node --test checks/engine.test.mjs
node checks/check-goldrush.cjs dist/gold-rush/play.html
python3 checks/test_deploy.py
node --test checks/leaderboard.test.mjs checks/score-queue.test.mjs checks/score-ui.test.mjs
```

For Windows, substitute the `py` launcher for `python3`. The three-phase shader check used a temporary ModernGL 5.12.0 / glcontext 3.0.0 installation, Mesa llvmpipe, NumPy and Pillow; these are QA tools and are not dependencies of the shipped site.
