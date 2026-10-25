# West Bank leaderboard — 1.1.1

Three public top-25 tables: **Tenderfoot** (`easy`), **Deputy** (`classic`) and **Gunslinger** (`hard`). Each browser player gets one best result per difficulty. Highest score wins; ties favour victory, then the furthest shift, fewer active simulation ticks, and the older result. A final player identifier is used only to make exact ties deterministic.

## For players

Choose **Play ranked** while the scorekeeper is available. After game over, victory, or **Pause → Finish run & save score**, the game panel immediately displays nickname entry and **Post score**. All these controls, including **Done · Main menu**, are inside the same playfield used by native fullscreen. Done exits fullscreen when available. Posting is optional. Personal device records still work if the public API is unavailable. A failed ranked-start request blocks that start and offers Retry ranked or an explicit Play practice choice. Offline/practice runs cannot be imported into the public board. Existing local records cannot prove a completed game and are not automatically uploaded.

Names accept 1–24 letters, numbers, spaces, underscores, dots or hyphens. Names are public nicknames, not verified accounts or reserved identities. The same spelling can belong to different players. A random 256-bit player key is kept in local browser storage; only its SHA-256 identifier is stored by the server. Clearing storage or changing browser/device creates a different player. There is no account or cross-device recovery process. This browser does keep up to six completed, unposted ranked replays for recovery through **Post saved score** on the menu. It protects the best queued candidate per difficulty when evicting older entries. Replays are removed locally after successful posting or explicit discard; tickets expire after 24 hours. If local storage is blocked or full, the result panel says to post before leaving the tab. Runs created by 1.1.0 were never persisted and cannot be reconstructed after being discarded. No passwords, cookies or analytics are added.

## Score integrity

1. `POST /api/west-bank/run` gives the browser a random seed and a signed, player-bound ticket for its chosen difficulty and engine hash.
2. The browser records the actual moves, shots, shift advances and voluntary finishes by simulation tick. Pauses do not consume simulation time.
3. `POST /api/west-bank/score` supplies the ticket, nickname, tick count and replay. The server replays the unchanged simulation in a bounded worker. It computes the score and progress itself and requires a positive score and a terminal game-over/victory state.
4. Tickets expire after 24 hours, cannot run faster than wall-clock time (three-second network/timing tolerance), and accept only one result. Retries of an accepted ticket return the same receipt. A ticket is not consumed when validation or saving fails.
5. Replay maximums are 360,000 active ticks (two hours), 20,000 actions, eight actions at one tick and a 768,000-byte JSON request. Exceeding client limits explicitly turns that run into practice; it never silently drops inputs from a ranked replay.

These checks prevent inventing a numeric score, changing difficulty, altering the simulation, posting incomplete games, and replaying an accepted ticket as another result. **They do not prove that a human played.** A person who writes a valid-playing bot can still compete; this is a friendly arcade board, not an esports anti-cheat system. Public names are not an authentication mechanism.

## Data and operation

The service is Node.js 22+ using only built-in modules; there is no npm install, external database or third-party leaderboard service. It listens on **127.0.0.1:8791**. Only `/api/west-bank/*` is proxied by the site's existing Caddy or Nginx host. All HTML, assets, games and rendering remain browser-side.

The systemd service `golden-moebius-leaderboard.service` uses a dynamic unprivileged user, a read-only system filesystem, a private temporary directory, no extra capabilities and a writable state directory. Node must be system-wide, outside `/root` and `/home`, because home directories are protected. The installer detects its actual absolute executable path and never replaces/upgrades the server's Node runtime.

Persistent state: **`/var/lib/golden-moebius-leaderboard/`** (systemd may expose this through its private-state symlink). `signing.key` and `leaderboard.json` are private files. State contains best results, player identifiers and accepted ticket receipts with a 24-hour validity window. Expired receipts are pruned on the next successful write; an idle state file may retain them longer. Replays and IP addresses are not saved by the application. Ordinary proxy/server logs are governed by existing server settings. Each difficulty retains up to 1,000 personal bests; the public response shows 25. A result outside the retained 1,000 can be verified without appearing on the board. At most 20,000 accepted ticket receipts are retained in a rolling day.

Writes are serialized and committed using a flushed temporary file, atomic rename and directory flush on Linux. Malformed existing state stops startup; it is never silently reset. The API rate-limits globally, per proxy connection address and per player, bounds request/header size and time, and permits only two verification workers at once. API responses use `Cache-Control: no-store`; if Cloudflare has an explicit rule overriding origin cache headers, exclude `/api/west-bank/*` from that rule. No application credentials or state files live under the public web root.

## Deployment, backups and rollback

Run `Deploy.ps1` on the Windows computer with the working `nyc1` alias. It uploads both public and service files, installs/enables the service, checks its local build marker, then reloads the web server. Public HTTPS checks cover all pages, service health and all three boards. Passworded sudo is supported via `ssh -t`.

Releases contain separate `public/` and `leaderboard/` directories. The web root is `current/public`. This separation also prevents downloading server source/state through the static file handler. Existing 1.0.0 releases and web-root contents remain in place.

An update snapshots affected configs, the previous systemd unit and service state, plus existing score data after stopping its writer. A failed validation, service start, health check or web-server reload restores the prior configuration, current release and prior service enabled/running state. New scores are never erased during a configuration rollback. Backups are root-private under `/var/backups/the-golden-moebius/`; keep the printed exact rollback command. Moving back to 1.0.0 disables/removes the newly added service but retains its scores on disk for future reinstall.

For diagnostics on NYC1:

```sh
sudo systemctl status golden-moebius-leaderboard.service --no-pager
sudo journalctl -u golden-moebius-leaderboard.service -n 60 --no-pager
curl --fail http://127.0.0.1:8791/api/west-bank/health
```

Do not delete `signing.key` or the state directory during normal site updates.

## Local preview and checks

With Node 22+, run `node leaderboard/server.mjs --dev --port 8080` and open http://127.0.0.1:8080/. This serves the local `dist/` and API together; development data uses a temporary directory and is never shipped to NYC1. Ctrl+C stops it. The production invocation does not serve static files and always binds to loopback. Development `--host`/`--port` options support the managed preview daemon.

Run `node --test checks/leaderboard.test.mjs` for full-game replay checks and real HTTP integration tests with an isolated temporary state directory. The tests never submit to yt.cafe or seed production tables.

Official implementation references: [Caddy handle blocks](https://caddyserver.com/docs/caddyfile/directives/handle), [Node worker threads](https://nodejs.org/download/release/v22.15.0/docs/api/worker_threads.html), [Node filesystem flush operations](https://nodejs.org/docs/latest-v22.x/api/fs.html), [systemd execution and state directories](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).
