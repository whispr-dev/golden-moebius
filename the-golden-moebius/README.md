# The Golden Möbius — 1.1.1

A complete website for **https://yt.cafe/**: a gently tongue-in-cheek field trip from Möbius topology to California's Sierra Nevada and the Gold Rush, with a liquid-gold 3D viewer and two browser games.

## Deploy to NYC1 from Windows

Extract the complete package. Open PowerShell in the resulting `the-golden-moebius` folder and run:

```powershell
.\Deploy.ps1
```

It uses your existing `ssh nyc1` alias. No Cloudflare API token, Node installation or local Python installation is required for deployment. Windows OpenSSH (`ssh` and `scp`) must be available. NYC1 needs Python 3.10 or later, a system-wide Node.js 22+ runtime, systemd, and an already running Caddy or Nginx service. Node powers the small public leaderboard API; there are no production npm dependencies. The installer checks the existing runtime and never upgrades it. The SSH account must be root or have sudo permission. The installer requests a terminal so sudo can ask for your account password when required. SSH may also prompt for your existing authentication as usual; no credentials are read or stored by this package.

The installer:

1. Uploads the prepared `site.tar.gz` and the server-side installer into a unique private temporary directory.
2. Detects the active Caddy or Nginx service and reads its file-backed configuration.
3. Locates the `yt.cafe` virtual host and preserves other domains. Existing TLS, logs and supported authentication directives are retained.
4. Verifies the archive transfer and every released file's SHA-256 checksum.
5. Installs a new release under `/var/www/the-golden-moebius/releases/` and backs up affected configuration under `/var/backups/the-golden-moebius/`.
6. Validates the candidate server configuration, switches the release and installs/enables the unprivileged leaderboard service. It checks the service locally before reloading the web server. A validation/start/health/reload failure restores the prior site and service configuration.
7. Checks the new build marker, all four public pages, API health and the three leaderboards through Cloudflare over HTTPS, then opens the homepage.

Old web-root contents are left in place. Old releases and configuration backups are retained. DNS, Cloudflare proxy settings, TLS mode, firewall rules and unrelated services are not changed. A new service, `golden-moebius-leaderboard.service`, serves only this site’s public leaderboard on loopback port 8791.

**Live deployment has not been performed from the build workspace.** That environment does not have your `nyc1` SSH alias, so the installer must run from the computer where the alias works. Its server-side planner and transaction logic were exercised against temporary fixtures; that does not substitute for inspecting NYC1's actual configuration.

To inspect the detected configuration without switching site content:

```powershell
.\Deploy.ps1 -InspectOnly
```

To select a service explicitly after checking which one owns the hostname:

```powershell
.\Deploy.ps1 -Server caddy
# Or, on an Nginx-served deployment:
.\Deploy.ps1 -Server nginx
```

Leave `-Server` out for normal automatic detection. If both services are active, the installer stops instead of guessing. The optional `-SshAlias` parameter changes the SSH alias only; the deployment remains scoped to `yt.cafe`.

## Fixed in 1.1.1

The 1.1.0 score form was below the cabinet, outside native fullscreen. At game over the prominent action was Ride again, so entering a leaderboard name was easy to miss or impossible to see in fullscreen.

- The result panel now contains **Enter your name**, **Post score**, **Done · Main menu** and **Play again**. Done also exits fullscreen when available.
- Pause or a cleared shift offers **Finish run & save score**. The same finish action is replay-verified by the server; it keeps earned points without awarding a victory bonus.
- Completed ranked runs are saved in this browser until posted (up to six, preserving the best candidate per difficulty when full). Done, starting another game, and page reload do not discard those saved runs. Use **Post saved score** in the menu. Tickets still expire 24 hours after issuance; browser storage must be available.
- If the scorekeeper cannot issue a ranked ticket, the game says so **before starting**. You can retry or explicitly choose Play practice. A practice or zero-score finish explains why no public score can be posted.
- Already-published leaderboards and device bests are preserved. Runs played in 1.1.0 were not saved for recovery; this update cannot reconstruct earlier discarded replays. New replay files are private browser-local data until you choose to post.
- The installer and whole project remain self-contained. Re-run Deploy.ps1; no new server packages are needed beyond the existing Node 22+ runtime.

## Added in 1.1.0

- Three public West Bank top-25 tables, one per difficulty; best result per browser player.
- Optional public nickname and score posting after a completed game. The server verifies the recorded game rather than trusting a submitted score number.
- Persistent scores across site updates, with no account signup or external leaderboard provider.
- “made by whispr.dev” and “© 2026 whispr.dev” on all seven pages.
- [Leaderboard operation, privacy, limits and backups](docs/LEADERBOARD.md). Existing device-only high scores remain local.

## Supported server layouts

**Caddy:** a Caddyfile used by the systemd service, including ordinary top-level file/glob imports. An existing site-address block may contain `yt.cafe` and `www.yt.cafe`, but no unrelated hosts. Its old routing is replaced by a static root at `current/public`, a file server and a scoped leaderboard API proxy; direct TLS, log, header, bind and basic-auth directives are preserved. If `yt.cafe` is absent and is not generated by an opaque template, a new block is appended to the existing Caddyfile. Caddy's normal automatic HTTPS behavior is retained.

**Nginx:** existing file-backed `yt.cafe` server blocks discoverable through `nginx -T`. Existing HTTP-to-HTTPS redirects, certificates, server-level basic authentication and ACME challenge locations are retained. The serving block gets the new static root at `current/public`, a `try_files $uri $uri/ =404` location, and a scoped `/api/west-bank/` proxy. Other old routing locations are replaced for this hostname. The installer does not invent a new Nginx TLS configuration when no serving host exists.

Host blocks shared with unrelated domains, site-local Caddy snippet imports, generated host templates, nested authentication, Nginx authentication subrequests and ambiguous active-service layouts require inspection. In those cases, the installer stops before changing server configuration and reports why. It will not remove access controls to make a deploy pass. Unusual pre-existing response headers are also preserved; if an old policy blocks scripts or same-origin framing, that policy must be reviewed for the new application.

## Roll back

A successful deploy prints an exact backup path and rollback command. The backup contains the installer, original affected config files, the previous current-link target and a restore record. Run the printed command on NYC1, or through your SSH alias. For example, use the **actual path printed by your deployment**, not an invented timestamp.

If public Cloudflare verification fails after the server accepted the deploy, the installer reports that distinction. It does not automatically undo a valid origin release merely because Cloudflare is unreachable or stale. Use the printed rollback command if you want to revert, or inspect the origin/proxy configuration first.

## Preview locally

With Node.js 22+ installed, from this folder:

```powershell
node .\leaderboard\server.mjs --dev --port 8080
```

Then open **http://127.0.0.1:8080/**. This previews the games and the real leaderboard API together, using temporary development data. Leave that PowerShell tab running; Ctrl+C stops it. The same command works on Linux/macOS with `/` path separators.

Use HTTP rather than opening individual files with `file:` URLs: ES module imports and relative route navigation are designed for an ordinary static web server.

## Routes

| URL | What is there |
| --- | --- |
| `/` | Arch photograph; a minimal maths lesson; an edge-tracing illustration; qualified examples from nature and the lab; arch geography; Gold Rush history; three experience links; sources and credits. |
| `/viewer/` | Shared navigation around the liquid-gold Möbius viewer. |
| `/gold-rush/` | Shared navigation around the California Gold Rush Trail survival game. |
| `/west-bank/` | Shared navigation around West Bank: Frontier Edition. |
| Each experience's `/play.html` | The full original-style experience without the shared outer page. |

All three subpages link back to the homepage and to one another. Each has instructions, an original-view link and a fullscreen control. No account system, analytics or cookies are included. Games use browser storage for personal records and preferences. West Bank also has a small server API for optional public scores; its random player key and chosen nickname are kept in the browser. Public scores persist on NYC1. Hosting and Cloudflare still process ordinary web requests.

## Content and visual choices

- The opening image is a real photograph by **Bob Wick / Bureau of Land Management**, framing the Mount Whitney massif through Möbius Arch. It is served locally, not hotlinked or AI generated. Attribution and reuse terms are in the page and `docs/SOURCES_AND_CREDITS.md`.
- The homepage distinguishes natural cyclotide proteins, laboratory-grown crystal bands, optical polarization, synthetic molecules and designed DNA origami. It does not present ordinary circular DNA as a Möbius strip.
- Möbius Arch is explicitly a visual resemblance, not a one-sided mathematical rock surface. The eastern Sierra location is distinguished from the Gold Rush's western foothills near Coloma.
- The games are labeled as playful fiction; the field notes provide the sourced historical thread. Indigenous dispossession and human/environmental costs are acknowledged.
- The viewer's gold shader and motion controls are retained. Its dependency is bundled locally, and a still preview appears if WebGL cannot initialize. The tiny homepage ribbon illustration uses Canvas 2D, so it does not require WebGL.
- The Gold Rush game includes the previous startup/event/death/retry fixes, guarded high-score storage and escaped user-supplied names. Archetype descriptions now describe their actual starting purses rather than promising unimplemented skill bonuses.
- The site's games keep their original retro visual styles within a shared outer navigation. No original West Bank ROM, extracted artwork or original soundtrack is shipped.

## Edit or rebuild

Browser runtime: ordinary HTML/CSS/JavaScript, WebGL for interactive 3D and Web Audio for game sound. Public leaderboard runtime: system-wide Node.js 22+, using only built-in modules. Assets are local. No build step or production npm installation is needed to deploy or play; the site and API payloads are ready to upload.

Build tools: **Node.js 22+**, **Python 3.10+**, and pinned **Tailwind CSS 3.4.17** if rebuilding the Gold Rush utility stylesheet. Three.js **0.186.1** is vendored under `dist/assets/vendor/three/` with its MIT license. Press Start 2P is bundled with its OFL license.

```powershell
npm ci --ignore-scripts
npm run build:trail
py .\checks\check_site.py
node --test .\checks\engine.test.mjs
node .\checks\check-goldrush.cjs .\dist\gold-rush\play.html
py .\checks\test_deploy.py
node --test .\checks\leaderboard.test.mjs .\checks\score-queue.test.mjs .\checks\score-ui.test.mjs
py .\build-package.py
```

`npm run check` is a convenience for Linux/macOS, where `python3` is normally on PATH. On Windows, the explicit `py` commands above avoid Python launcher/PATH ambiguity. The checks use Python and Node standard libraries; they do not require a running web server or npm packages.

After source edits, run `build-package.py` before deploying. It refreshes the build marker, builds the checksum-verified `site.tar.gz` payload and creates the full project archive. The deployment never serves `deploy/`, `checks/`, `node_modules/` or configuration backups.

## Complete project contents

```text
the-golden-moebius/
  README.md
  Deploy.ps1
  build-package.py
  package.json
  package-lock.json
  tailwind.config.cjs
  site.tar.gz
  src/trail.css
  leaderboard/server.mjs
  leaderboard/verify.mjs
  deploy/deploy-server.py
  checks/check_site.py
  checks/check-goldrush.cjs
  checks/engine.test.mjs
  checks/test_deploy.py
  checks/leaderboard.test.mjs
  checks/score-queue.test.mjs
  checks/score-ui.test.mjs
  docs/SOURCES_AND_CREDITS.md
  docs/VALIDATION.md
  docs/LEADERBOARD.md
  dist/
    index.html
    robots.txt
    sitemap.xml
    site-version.json
    assets/
      site.css
      credits.css
      home.js
      experience.js
      favicon.svg
      mobius-arch-960.webp
      mobius-arch-1920.webp
      mobius-arch-social.jpg
      liquid-gold.webp
      gold-rush-preview.webp
      west-bank-preview.webp
      trail.css
      press-start-2p.ttf
      press-start-OFL.txt
      vendor/tailwind-LICENSE.txt
      vendor/three/{three.module.js,three.core.js,LICENSE.txt}
    viewer/{index.html,play.html}
    gold-rush/{index.html,play.html}
    west-bank/
      leaderboard.js
      leaderboard.css
      engine-version.js
      score-queue.js
      index.html
      play.html
      game.js
      engine.js
      style.css
      favicon.svg
      package.json
      west-bank-source.tar.gz
```
