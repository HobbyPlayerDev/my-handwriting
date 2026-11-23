# Changelog

## 1.6.0 - 2026-11-23
- **Nothing is cut off at the edge any more:** slant, tremor and pen width can carry a stroke a little
  past the writing line. With no margin (`--margin 0`, e.g. when Claude wrote single digits for a
  calculation) that part was cut off – a "0" looked open, a "1" lost its up-stroke. Now the writing is
  moved inside, and with "Fit to text" the page grows a little. Same in the app (PNG/SVG/PDF).
- **No light rim around letters** in transparent PNGs: the soft edge pixels mixed in white, so letters
  placed on paper or into a PDF had a pale outline. Now the edges keep the ink colour.
- **Writing area size** (Settings → Writing area): 10–160 %, live while you slide – or **Ctrl + mouse
  wheel** on the writing side of the page (⌘ on a Mac; a touchpad pinch works too). Smaller for small letters,
  bigger for big letters on a large screen. Saved for this device only; your samples stay the same at
  every size. On a small area the line names are left out, so nothing lies across the letter.
- **Line width while writing** (Settings → Writing area): 25–300 %, e.g. thinner lines on a big area,
  thicker ones on a small one. Only how the lines look while you write (this device) – your samples
  and the documents stay the same.
- **Tidier settings:** the small grey explanations are gone, shorter texts ("Character by character",
  "In rounds (A, B, C …)", "Automatic"), the two red buttons stay the same size side by side – the
  "press again" text wraps inside instead of pushing the other button away.
- Tested on a real Android phone, iPhone and iPad: everything works (README "Tested on").
- **Claude knows more:** you decide what to write – learning notes, homework, calculations, letters,
  thank-you cards, job applications. For calculations and worksheets Claude keeps a margin and places
  pieces with the new `page_boxes` of the report (page size and where the ink is, in mm) instead of
  guessing at the image edge.

## 1.5.1 - 2026-11-20
- **Claude can set everything the app can:** size, paper, format, colour, alignment, irregularity (in
  % like the slider), "look real", standard handwriting, transparent background, shuffle. It starts
  every answer with one line listing all settings in the app's words and language ("Einstellungen:
  Größe: 6 mm · … · Unregelmäßigkeit: 50 % · Echt wirken lassen: an"), then answers as usual, and
  changes a setting when you ask ("bigger", "neater", "in red"). Skill: `--irregularity 0-100`,
  `settings_line` in the report.
- **Document defaults** (setup step "Documents" and Settings → Documents) now include alignment and
  irregularity; every irregularity slider shows its value in %.
- **Fixed:** letters slid into each other after a straight stroke (BB, DD, AA) – a straight line is
  stored with its end points only, and the spacing did not see its middle. The gap between letters is
  also never narrower than the pen any more (high irregularity).
- The skill is called **/my-handwriting** – now said in the app and the README; the ZIP must not be
  unzipped, also on the phone (upload at claude.ai). The skill ZIP now carries the MIT license.
- "Fit to text" (PNG/SVG): after `[[pagebreak]]` every page is as high as its own text (a short
  last page had the height of the longest one, full of empty lines).
- Android: a 192 px app icon was missing (Chrome wants 192 + 512 px for "Install app").
- **Long texts are fast again:** a long paragraph in "Write text" got slower with every character
  (18 pages took 5 s, 67 pages 95 s – the browser froze while typing). Now 18 pages take 0.6 s.
- **Safer storage:** if the browser cannot read your saved samples at start (storage slow or busy),
  the app no longer starts with an empty handwriting that would overwrite them on the next save. It
  says so and saves nothing until the page is reloaded.
- "Replace" on import can be undone (like deleting samples).
- Broken numbers in a file (size, irregularity) no longer produce empty or broken PNG/SVG/PDF.
- README: banner, installation right at the top, example output, "How it works" with Claude,
  "Built with Claude"; GitHub bug report template that warns not to attach the sample file.
- The app says what it is made for: "Teach Claude your handwriting" (setup welcome in all 6
  languages, page description, app manifest).

## 1.4.0 - 2026-11-20
- **Look real** (option, on by default – in the setup step "Documents", the settings and "Write
  text"): every letter a little wider or narrower and more or less slanted, a soft hand tremor along
  the strokes, changing pen pressure with lighter starts and ends, the size breathes along the line
  and each word sits slightly higher or lower. Works in PNG, SVG and PDF, in the app and in the Claude
  skill (`--realism` / `--no-realism`, default from the app).
- **Install as app** (menu): shows the steps for iPhone/iPad, Android and computers, marks your
  device, offers the browser's own install button where there is one and explains that a file opened
  by double-click cannot be installed. README: new section "Install on your device".
- **New app icon:** a white handwritten stroke on dark blue (browser tab, header, setup, home screen).
- Shorter texts: "Fair use", the delete/reset confirmations and the reset note; the document preview
  no longer uses a name ("Dear Grandma, thank you so much!"). "Delete samples" is disabled when there
  are none. The slider in "Write text" is now called "Irregularity".

## 1.3.0 - 2026-11-20
- **Own drop-down lists** in the app's style instead of the system lists (which were plain white on
  Windows); keyboard works too (arrows, Enter, Esc, first letter).
- **Menus are solid** – the see-through menu over the overview looked broken.
- **More motion, used sparingly:** a green tick on the writing area when you save, the new sample
  pops in, the progress dot pops, a finished character bumps in the overview, the big letter slides
  in when it changes, setup steps slide left/right, dialogs and the message at the bottom slide out.
  Switched off when the system asks for reduced motion.
- **Setup helper:** no "Skip" any more (on the very first start it is gone through once; later it
  has an ×). New step **Documents** (paper, size, colour, format – used by "Write text" and by Claude)
  with a live preview. Claude simply answers in the language chosen in the setup.
- Clearer texts: what "standard handwriting" means, "guide letter (recommended)" with a short
  explanation, step 1 reworded; the Claude window says which handwriting is in the ZIP.
- Fixes: menus no longer close when a phone's address bar slides in or out; a drop-down that is
  partly off screen scrolls into view first; the pen badge no longer pushes the phone header into
  two rows.

## 1.2.0 - 2026-11-20
- **New look:** calm, modern design with rounded cards, a frosted header, pill buttons, a big Save
  button on phones, dialogs that slide up as sheets on phones, and a **dark mode** (the writing area
  stays white like paper). All emojis are replaced by **own icons** (drawn for this project).
- **Use in Claude, simplified:** one way for everyone – download the ZIP, upload it in Claude
  (Customize → Skills), ask. Works on the free plan, on the web, desktop, phone and in Claude Code.
- **Shorter texts** everywhere (help as a short list, setup helper, banners), in all 6 languages.
- Every dialog has an **×**; the phone's **back button** closes dialogs.
- **Only one tab at a time:** a second open tab pauses the first one, so two tabs never overwrite
  each other's samples ("Use here" switches back).
- A message appears if the app cannot start (very old browser, JavaScript off).
- App icon as PNG for iPhone/iPad home screens; screenshot and a shorter, clearer README.
- Notices: Claude trademark note (independent project), own icons; tests also check the offline file
  list and the icon sprite.

## 1.1.0 - 2026-11-17
- **Clearer page:** the header only has "Write text", "Use in Claude", "Export" and a menu (☰) with
  import, settings, setup helper, help and language. Overview groups can be folded; only the group
  you are working on is open.
- **Setup helper** as a big window with a step list (language, how it works, you, Claude, practice,
  ready); the steps you have seen can be clicked. New: a name for the handwriting.
- **Several handwritings** (family members, neat/quick style): create, switch (button next to the
  logo), rename, delete (with undo). Each has its own samples and settings; the interface language
  belongs to the device.
- **Reset everything** in the settings (back to the first start, undo until the page is closed).
- **Use in Claude:** the app builds the Claude skill with your handwriting as a ZIP in the browser
  (optionally with all handwritings) and offers ready-made messages: Claude Code installs it by
  itself, for the Claude app there are the upload steps, and for a single chat a message to attach.
- Skill / script: several handwritings (`data/glyphs-<name>.json`, `--profile`, `install --name`),
  `info` lists them.

## 1.0.0 - 2026-11-17
First public version (the project was called "Handschrift" before; its files are still read).

- **6 languages** for the whole interface (English default, Deutsch, Français, Español, Italiano,
  Polski), with the complete special letters of each language (e.g. ẞ ‚ ‘ » «, Æ Œ Ÿ, ª º ¿ ¡,
  Í Î Ó Ú, Ą Ł Ż, £).
- **Start wizard** in 6 steps: interface language, how it works, languages you write, Claude &
  documents (Claude's language, paper, size, colour, page, standard handwriting), practice, tips.
- **Standard handwriting** for characters you have not written (Hershey font + hand-drawn extras),
  fitted to your size, x-height and slant. Own samples always come first (also composed: é, ł, ½, ¿).
  Can be switched off (red boxes).
- **Claude skill `/my-handwriting`** with `info`, `install` and `package`; Claude writes Markdown and
  renders a PDF with your defaults from the app.
- **Markdown** in "Write text" and in the script: headings, lists, rules, `[[pagebreak]]`.
- **Pen laptops** (S Pen, Surface Pen): a hovering pen is detected before the first stroke and
  remembered; a pen replaces a touch (palm) stroke; side button and eraser end erase.
- **Own characters** are added directly in the overview and appear at once; characters that are
  already in a group are shown there instead.
- Faint guide letter, undo for clearing/erasing, offline app (GitHub Pages), PNG/SVG/compressed PDF.
- English project structure, MIT license, tests + GitHub Actions.
