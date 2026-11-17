# Publishing on GitHub

## Check: anything against it? (as of 2026-11-17)

| Question | Result |
|---|---|
| Personal data in the code? | None: no names, e-mail addresses, local paths or samples. Sample files (`skill/my-handwriting/data/`, `*-glyphs-*.json`), outputs and `out/` are in `.gitignore`. |
| **E-mail in commits** | Git writes the author e-mail into every commit, and commits are public. Turn on GitHub → Settings → Emails → "Keep my email addresses private" and use the shown `…@users.noreply.github.com` address for this repository (see below). |
| License | MIT (`LICENSE`). Third-party data: the Hershey fonts (free use with acknowledgement, see `NOTICE.md` and `tools/hershey/LICENSE-hershey.txt`). No other third-party code, fonts or images. Pillow (optional, PNG only) is not included. |
| Works for everyone? | Web app: current Edge/Chrome/Firefox on Windows tested (pen/touch simulated), phone layout tested. Real iPads/Android/pen laptops not yet. Data loss possible if someone never exports (the app reminds). Script: Python 3.8+, standard library. |
| Similar projects? | Yes, but different (see README → "How it compares"). Publishing is fine. |
| Name | "my-handwriting" is a plain description, no known trademark. |
| Misuse | "Use it fairly" in help (all languages), README and SKILL.md; no signature feature. |
| Security | No server, no network access, no secrets in the code. |

## Step by step (GitHub Desktop)

1. **Protect your e-mail:** github.com → Settings → Emails → "Keep my email addresses private" on.
   Copy the shown address (`12345678+<user>@users.noreply.github.com`).
2. In the project folder (terminal):
   ```bash
   git config user.email "YOUR-NOREPLY-ADDRESS"
   ```
   (only for this repository)
3. GitHub Desktop → *File → Add local repository* → choose the `my-handwriting` folder.
4. Check the file list: **no** `glyphs.json`, no `*-glyphs-*.json`, no `out/`. Commit message
   e.g. "my-handwriting 1.0.0" → *Commit to main*.
5. *Publish repository* → name `my-handwriting`; untick "Keep this code private" to make it public.
6. Online version: github.com → repository → Settings → Pages → *Deploy from a branch* → `main` /
   `(root)` → Save. After 1-2 minutes the app runs at `https://<user>.github.io/my-handwriting/`
   (also on iPad/phone, installable, offline).
7. Under *Actions* the tests run on every push (`.github/workflows/tests.yml`).
8. Release: *Releases → Draft a new release* → tag `v1.0.0`, title "my-handwriting 1.0.0", text from
   `CHANGELOG.md`. Optional: attach a `my-handwriting-skill.zip` built **without** `--glyphs`.
9. Repository description + topics, e.g. `handwriting`, `pen`, `pdf`, `claude-skill`, `offline`.

## Versions
Bump together: `APP_VERSION` in `js/app.js`, `VERSION` in `skill/my-handwriting/scripts/my_handwriting.py`,
`VERSION` (cache name) in `sw.js`; add an entry to `CHANGELOG.md`. Public numbering started at 1.0.0
(the earlier private "Handschrift" 1.0/2.0 are not counted).
