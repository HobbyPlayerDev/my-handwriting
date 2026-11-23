# Publishing on GitHub

## Check before every release (as of 2026-11-23, version 1.6.0)

| Question | Result |
|---|---|
| Personal data in the code? | None: no names, e-mail addresses, local paths or real samples. Sample files (`skill/my-handwriting/data/`, `*-glyphs-*.json`, `my-handwriting-skill.zip`), outputs and `out/` are in `.gitignore`. The README example and screenshot show an example handwriting the owner wrote in the app (pictures only, no sample file). |
| E-mail in commits | Git writes the author e-mail into every commit. Use the GitHub `…@users.noreply.github.com` address (GitHub → Settings → Emails → "Keep my email addresses private"). Check: `git log --format=%ae` shows only the noreply address. |
| License | MIT (`LICENSE`, a copy in `skill/my-handwriting/` so the skill ZIP carries it too). Third-party data: Hershey fonts (free use with acknowledgement, `NOTICE.md`, `tools/hershey/LICENSE-hershey.txt`). No other third-party code, fonts or images. |
| Icons / logos | All icons drawn for this project (SVG sprite in `index.html`, `icon.svg`, `icons/*.png`). No Claude/Anthropic logo, no Anthropic brand colour, no emoji images. |
| "Claude" name | Only used to describe compatibility (nominative use), with a trademark note in README and NOTICE ("not affiliated with Anthropic"). |
| Fonts | None shipped. The guide letter uses the system font of the device at runtime (nothing is distributed or saved). |
| Privacy | No server, no tracking, no cookies, no network requests (except the user opening claude.ai links). GitHub Pages itself logs IP addresses like any web host (GitHub's privacy statement). |
| Misuse | "Fair use" in help (all languages), README and SKILL.md; no signature feature. |
| Works for everyone? | Edge/Chromium tested (desktop, 375 px phone, dark mode, pen/touch simulated, file:// and http); Firefox 152 tested headless (start, save, data after restart, ZIP, PDF, back button – file:// and http). Real Android phone, iPhone and iPad (Safari) tested by the owner (2026-11-23): everything works. Pen laptops not yet tried. Old browsers get a "could not start" message. |

## First release, step by step (GitHub website + GitHub Desktop)

Use **GitHub Desktop** (or `git`), not drag-and-drop on github.com: only git respects `.gitignore`.
A web upload of the whole folder would also upload `out/` (test outputs, possibly of your real
handwriting) and `__pycache__/`. If you must upload on the website, delete `out/` first.

1. **Commit** all changes (GitHub Desktop: check the file list – no `glyphs.json`, no `out/`, no ZIP –
   message e.g. "my-handwriting 1.5.1" → *Commit to main*).
2. **Publish repository** → name exactly `my-handwriting` (the app and README link to
   `hobbyplayerdev.github.io/my-handwriting/`), untick "Keep this code private" → *Publish*.
3. Repository page → ⚙ *About*: description "Teach Claude your handwriting – Claude (or the app)
   writes any text in your hand. Offline web app + Claude skill.", website
   `https://<user>.github.io/my-handwriting/`, topics `claude`, `claude-skill`, `handwriting`, `pen`,
   `pdf`, `svg`, `offline`, `pwa`.
4. **GitHub Pages:** *Settings → Pages → Build and deployment → Deploy from a branch → main / (root)
   → Save*. After 1-2 minutes the app runs at `https://<user>.github.io/my-handwriting/`.
5. **Actions:** the *tests* workflow runs on every push; it must be green.
6. **Release:** *Releases → Draft a new release → Choose a tag → `v1.5.1` (create on publish)*,
   title "My Handwriting 1.5.1", text = "First public release." plus the 1.5.1 section of `CHANGELOG.md`
   (versions before were never published) → *Publish release*.
   GitHub attaches the source code ZIP automatically (that is the offline download for users).
7. Open the Pages address once on a phone/iPad and check: setup, write, Write text → PDF, Use in Claude.

## Later releases

1. Bump together: `APP_VERSION` in `js/app.js`, `VERSION` in `skill/my-handwriting/scripts/my_handwriting.py`,
   `VERSION` (cache name) in `sw.js`; run `python tools/build_skill_bundle.py`.
2. New `CHANGELOG.md` section; run all tests (README → Development).
3. Commit, push, new release `vX.Y.Z` with the changelog text. GitHub Pages updates by itself; the
   service worker loads the new version on the next visit (network first).

Public numbering started at 1.0.0 (the earlier private "Handschrift" 1.0/2.0 are not counted).
