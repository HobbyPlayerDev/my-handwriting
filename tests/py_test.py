#!/usr/bin/env python3
"""Tests for skill/my-handwriting/scripts/my_handwriting.py and its consistency with the web app.

    python tests/py_test.py      (builds its own synthetic fixture; Pillow needed for it and for PNG)
"""
import json
import math
import os
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skill", "my-handwriting", "scripts")
SCRIPT = os.path.join(SCRIPTS, "my_handwriting.py")
sys.path.insert(0, SCRIPTS)
import my_handwriting as hs  # noqa: E402

fails = checks = 0


def ok(cond, msg):
    global fails, checks
    checks += 1
    if not cond:
        fails += 1
        print("FAIL " + msg)


def run(*args, lang="en", env=None):
    e = dict(os.environ, MY_HANDWRITING_LANG=lang)
    e.pop("MY_HANDWRITING_GLYPHS", None)
    e.update(env or {})
    p = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, env=e)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def node(code, *args):
    out = subprocess.run(["node", "-e", code] + list(args), capture_output=True, check=True).stdout
    return json.loads(out.decode("utf-8"))


# 1. the same rules as the web app (charsets, replacements, Markdown blocks, standard handwriting)
try:
    js = node("const c=require(process.argv[1]);console.log(JSON.stringify(c))", os.path.join(ROOT, "js", "charsets.js"))
    ok([(g["id"], g["chars"]) for g in js["BASE"]] == [(g, c) for g, _n, c in hs.GROUPS], "BASE groups equal")
    ok(js["LANG"] == hs.LANG_GROUPS, "LANG groups equal")
    ok(js["LANG_ORDER"] == list(hs.LANG_ORDER), "LANG_ORDER equal")
    ok(js["CORE"] == list(hs.CORE_GROUPS), "CORE equal")
    r = node("const R=require(process.argv[1]);console.log(JSON.stringify({fb:R.FALLBACKS,approx:R.APPROX}))",
             os.path.join(ROOT, "js", "render.js"))
    py_fb = {k: (list(v) if isinstance(v, tuple) else v) for k, v in hs.FALLBACKS.items()}
    ok(r["fb"] == py_fb, "FALLBACKS equal: %s" % sorted(set(r["fb"].items()) ^ set((k, json.dumps(v)) for k, v in py_fb.items()))[:3]
       if r["fb"] != py_fb else "FALLBACKS equal")
    ok(r["approx"] == hs.APPROX, "APPROX equal")
    lines = ["# Title", "## Sub ##", "### small", "- item", "  * nested", "    + deeper", "12. twelve", "b) letter", "> quote",
             "---", "***", "[[pagebreak]]", "plain **bold** __u__ `code`", "#no heading", "-no list"]
    jsb = node("const R=require(process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(l=>R.parseBlock(l,true))))",
               os.path.join(ROOT, "js", "render.js"), json.dumps(lines))
    for line, jb in zip(lines, jsb):
        pb = hs.parse_block(line, True)
        ok(all(abs(pb.get(k, 0) - jb.get(k, 0)) < 1e-9 if isinstance(jb.get(k), (int, float)) and not isinstance(jb.get(k), bool)
               else pb.get(k) == jb.get(k) for k in set(jb) | set(pb)), "parse_block %r: %s vs %s" % (line, pb, jb))
    font_js = node("console.log(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "js", "fallback-font.js"))
    font_py = json.load(open(os.path.join(SCRIPTS, "fallback_font.json"), encoding="utf-8"))
    ok(font_js == font_py, "standard handwriting identical in js/ and skill/ (run tools/build_fallback_font.py)")
except (OSError, subprocess.CalledProcessError) as e:
    print("note: node not available, comparison with the web app skipped (%s)" % e)

tmp = tempfile.mkdtemp(prefix="mh-test-")
fx = os.path.join(tmp, "fx.json")
subprocess.run([sys.executable, os.path.join(ROOT, "tests", "make_fixture.py"), fx, "--samples", "3"], check=True, capture_output=True)
basic = os.path.join(tmp, "basic.json")
subprocess.run([sys.executable, os.path.join(ROOT, "tests", "make_fixture.py"), basic, "--samples", "3",
                "--chars", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-'\""], check=True, capture_output=True)

# 2. check
code, out, err = run("check", "--glyphs", fx, "--json")
rep = json.loads(out)
ok(code == 0 and rep["verdict_code"] == "ready", "check ready: %s" % rep.get("verdict_code"))
ok(rep["scripts"] == list(hs.LANG_ORDER), "scripts from file")
code, out, err = run("check", "--glyphs", basic, "--json", "--scripts", "de")
rep = json.loads(out)
ok(rep["verdict_code"] in ("usable", "incomplete") and set(rep["core_missing"]) >= set("ÄÖÜäöüß"), "basic: not ready, umlauts missing")
code, out, err = run("check", "--glyphs", fx, lang="de")
ok("Großbuchstaben" in out and "Ergebnis: bereit" in out, "German output")
code, out, err = run("--lang", "en", "check", "--glyphs", fx, lang="de")
ok("Capital letters" in out and "Result: ready" in out, "--lang en overrides")

# 3. render all formats; every language's letters
txt = os.path.join(tmp, "t.txt")
with open(txt, "w", encoding="utf-8") as fh:
    fh.write("¿Qué tal? Łódź – „Grüße“ ½ [[3/4]] Œuvre ẞ ª º £\n" + "Line\n" * 70)
for ext in ("pdf", "svg", "png"):
    o = os.path.join(tmp, "out." + ext)
    code, out, err = run("render", "--glyphs", fx, "--input", txt, "--out", o, "--json", "--seed", "4")
    ok(code == 0, "render %s exit %s %s" % (ext, code, err))
    if code == 0:
        rep = json.loads(out)
        ok(rep["pages"] >= (2 if ext == "pdf" else 1) and not rep["missing"] and not rep["standard_handwriting"],
           "render %s pages/missing: %s" % (ext, rep))
        ok(all(os.path.getsize(f) > 500 for f in rep["files"]), "render %s files" % ext)
all_letters = "".join(hs.LANG_GROUPS[c] for c in hs.LANG_ORDER)
code, out, err = run("render", "--glyphs", basic, "--text", all_letters, "--out", os.path.join(tmp, "l.svg"), "--json")
rep = json.loads(out)
ok(code == 0 and not rep["missing"], "all special letters work with only basic samples: missing %s" % rep.get("missing"))
ok({"é", "ñ", "ą"} <= set(rep["fallbacks"]) and "ß" in rep["standard_handwriting"], "composed + standard handwriting: %s" % rep["standard_handwriting"])
code, out, err = run("render", "--glyphs", basic, "--text", all_letters, "--out", os.path.join(tmp, "l2.svg"), "--json", "--no-font")
rep = json.loads(out)
ok(code == 0 and rep["missing"] and not rep["standard_handwriting"], "--no-font: red boxes instead")
code, out, err = run("render", "--glyphs", basic, "--text", "€ ł", "--out", os.path.join(tmp, "e.svg"), "--json")
rep = json.loads(out)
ok(rep["standard_handwriting"] == ["€"] and rep["fallbacks"].get("ł") == "l + /", "€ from the font, ł from own l: %s" % rep)
code, out, err = run("render", "--glyphs", basic, "--text", "Ω", "--out", os.path.join(tmp, "x.svg"), "--missing", "error")
ok(code == 2 and "Ω" in err, "missing=error stops with exit 2")
code, out, err = run("render", "--glyphs", os.path.join(tmp, "nope.json"), "--text", "x", "--out", os.path.join(tmp, "x.svg"))
ok(code == 2 and "Sample file not found" in err and "install --glyphs" in err, "clear error for a missing file")
code, out, err = run("render", "--glyphs", fx, "--text", "Hi", "--out", os.path.join(tmp, "x.svg"))
ok(code == 0 and "✓" in out, "✓ survives a pipe (Windows code page)")

# 4. Markdown + page break; defaults from the app (settings.claude)
md = os.path.join(tmp, "letter.md")
with open(md, "w", encoding="utf-8") as fh:
    fh.write("# Dear Ann\n\nThank you!\n\n- one\n- two\n1. first\n---\n[[pagebreak]]\nPage two")
code, out, err = run("render", "--glyphs", fx, "--input", md, "--markdown", "--out", os.path.join(tmp, "md.pdf"), "--json")
rep = json.loads(out)
ok(code == 0 and rep["pages"] == 2 and rep["settings"]["markdown"], "markdown + page break: %s" % rep.get("pages"))
ok(rep["settings"]["paper"] == "lined" and rep["settings"]["size"] == 6.0, "built-in Claude defaults: %s" % rep["settings"])
withc = json.load(open(fx, encoding="utf-8"))
withc["settings"]["claude"] = {"lang": "de", "paper": "grid", "size": 8, "color": "black", "page": "a5", "fallback": "box", "realism": False,
                               "align": "center", "variation": 0.4}
cpath = os.path.join(tmp, "claude.json")
json.dump(withc, open(cpath, "w", encoding="utf-8"))
code, out, err = run("render", "--glyphs", cpath, "--text", "Hi", "--out", os.path.join(tmp, "c.pdf"), "--json")
rep = json.loads(out)
ok(rep["settings"] == {"paper": "grid", "size": 8.0, "color": "black", "page": "a5", "align": "center", "irregularity": 20,
                       "variation": 0.4, "landscape": False, "transparent": False, "markdown": False, "font": False, "realism": False},
   "defaults from the app: %s" % rep["settings"])
ok(rep["settings_line"] == "Einstellungen: Größe: 8 mm · Papier: Kariert · Format: A5 · Farbe: Schwarz · Ausrichtung: Mitte · "
   "Unregelmäßigkeit: 20 % · Echt wirken lassen: aus · Fehlende Zeichen ergänzen: aus", "settings line in the app's language: %s" % rep["settings_line"])
code, out, err = run("render", "--glyphs", cpath, "--text", "Hi", "--out", os.path.join(tmp, "c3.png"), "--irregularity", "80", "--align", "right",
                     "--color", "red", "--transparent")
ok(code == 0 and out.splitlines()[0] == "Einstellungen: Größe: 8 mm · Papier: Kariert · Format: Passend zum Text · Farbe: Rot · "
   "Ausrichtung: Rechts · Unregelmäßigkeit: 80 % · Echt wirken lassen: aus · Fehlende Zeichen ergänzen: aus · Transparenter Hintergrund: an",
   "settings line first, with the changes from the chat: %s" % out.splitlines()[:1])
code, out, err = run("render", "--glyphs", cpath, "--text", "Hi", "--out", os.path.join(tmp, "c4.pdf"), "--irregularity", "150")
ok(code != 0 and "irregularity" in err, "--irregularity above 100 is refused")
code, out, err = run("render", "--glyphs", fx, "--text", "Hi", "--out", os.path.join(tmp, "c5.pdf"), "--json")
ok(json.loads(out)["settings_line"].startswith("Settings: Size: 6 mm · Paper: Lined · Format: A4 · Colour: Blue · Alignment: Left · Irregularity: 50 %"),
   "settings line without app settings: English defaults")
# the settings line uses exactly the words of the app (js/lang/<code>.js)
for code_, labels in hs.SETTING_LABELS.items():
    table = node("const I=require(process.argv[1]);require(process.argv[2]);console.log(JSON.stringify(I.TABLES[process.argv[3]]))",
                 os.path.join(ROOT, "js", "i18n.js"), os.path.join(ROOT, "js", "lang", code_ + ".js"), code_)
    diff = [k for k, v in zip(hs.SETTING_KEYS, labels) if k not in ("on", "off") and table.get(k) != v]
    ok(not diff and len(labels) == len(hs.SETTING_KEYS), code_ + ": settings labels equal to the app: %s" % diff)
ok(sorted(hs.SETTING_LABELS) == sorted(hs.LANG_ORDER) or set(hs.SETTING_LABELS) >= {"de", "en", "fr", "es", "it", "pl"}, "settings labels for all 6 languages")
code, out, err = run("render", "--glyphs", cpath, "--text", "Hi", "--out", os.path.join(tmp, "c2.pdf"), "--json", "--paper", "blank", "--font")
rep = json.loads(out)
ok(rep["settings"]["paper"] == "blank" and rep["settings"]["font"], "command line beats the app defaults")
# realism (tremor, stretch, pen pressure): on without a setting, off from the app, --realism wins
code, out, err = run("render", "--glyphs", fx, "--text", "Hallo Welt", "--out", os.path.join(tmp, "r1.svg"), "--json", "--seed", "4")
ok(code == 0 and json.loads(out)["settings"]["realism"] is True, "realism is on by default")
svg_on = open(os.path.join(tmp, "r1.svg"), encoding="utf-8").read()
ok(svg_on.count("stroke-linecap") > 3, "realism: several pen widths in the SVG")
code, out, err = run("render", "--glyphs", cpath, "--text", "Hallo Welt", "--out", os.path.join(tmp, "r2.svg"), "--json", "--realism")
ok(code == 0 and json.loads(out)["settings"]["realism"] is True, "--realism beats the app setting")
code, out, err = run("render", "--glyphs", fx, "--text", "Hallo Welt", "--out", os.path.join(tmp, "r3.svg"), "--no-realism", "--seed", "4")
ok(code == 0 and open(os.path.join(tmp, "r3.svg"), encoding="utf-8").read().count("stroke-linecap") == 1, "--no-realism: one even pen width")

# "fit to text": a short page after [[pagebreak]] stays short (same as the web app)
code, out, err = run("render", "--glyphs", fx, "--text", "one\ntwo\nthree\nfour\n[[pagebreak]]\nfive", "--markdown",
                     "--out", os.path.join(tmp, "pb.svg"), "--json")
_hs = [float(open(f, encoding="utf-8").read().split('height="')[1].split("mm")[0]) for f in json.loads(out)["files"]]
ok(len(_hs) == 2 and _hs[1] < _hs[0] * 0.6, "fit to text: every page as high as its own lines: %s" % _hs)

# kerning: a straight stem keeps only its end points (simplify) - the next letter must not slide into it
def _bowl(y0, y1, w):
    pts = []
    for i in range(25):
        a = -math.pi / 2 + math.pi * i / 24
        pts += [round(100 + w * math.cos(a)), round((y0 + y1) / 2 + (y1 - y0) / 2 * math.sin(a))]
    return pts
_B = {"strokes": [[100, 0, 100, 1000], _bowl(1000, 520, 380), _bowl(520, 0, 450)]}
_kfile = os.path.join(tmp, "stem.json")
json.dump({"format": "my-handwriting-glyphs", "version": 1, "metrics": {"scale": 1000}, "glyphs": {"B": [_B, _B, _B]}}, open(_kfile, "w"))
_gs = hs.GlyphSet(_kfile, 0, 0.0)
_ts = hs.Typesetter(_gs, hs.random.Random(1), 0.0)
_a, _b = _ts.glyph_box("B"), _ts.glyph_box("B")
ok(hs.kern_offset(_a, _b, 0.15, 1.0) >= _a.w + 0.14, "kerning: no overlap with a straight stem (BB): %.3f vs %.3f" % (hs.kern_offset(_a, _b, 0.15, 1.0), _a.w + 0.15))

# 5. info (what the skill reads first)
code, out, err = run("info", "--glyphs", cpath)
info = json.loads(out)
ok(code == 0 and info["ready"] and info["claude"]["lang"] == "de" and info["languages"] == list(hs.LANG_ORDER), "info: %s" % info.get("claude"))
ok(info["standard_handwriting_available"] and "missing" in info["languages_missing"]["pl"], "info: per language")
code, out, err = run("info", env={"HOME": tmp, "USERPROFILE": tmp, "MY_HANDWRITING_GLYPHS": os.path.join(tmp, "none.json")})
info = json.loads(out)
ok(code == 1 and not info["ready"] and "install --glyphs" in info["problem"], "info without a file explains what to do")
code, out, err = run("info", env={"MY_HANDWRITING_GLYPHS": fx})
ok(code == 0 and json.loads(out)["glyphs"] == os.path.abspath(fx), "MY_HANDWRITING_GLYPHS is used")

# 6. install + package
dest = os.path.join(tmp, "skills", "my-handwriting")
code, out, err = run("install", "--glyphs", fx, "--dest", dest)
ok(code == 0 and os.path.isfile(os.path.join(dest, "SKILL.md")) and os.path.isfile(os.path.join(dest, "data", "glyphs.json"))
   and os.path.isfile(os.path.join(dest, "scripts", "fallback_font.json")), "install copies the skill + file: %s %s" % (out, err))
code, out, err = run("install", "--glyphs", cpath, "--dest", dest)
ok(code == 0 and os.path.isfile(os.path.join(dest, "data", "glyphs.json.bak")), "install again keeps a backup")
inst = os.path.join(dest, "scripts", "my_handwriting.py")
p = subprocess.run([sys.executable, inst, "info"], capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
ok(p.returncode == 0 and json.loads(p.stdout.decode("utf-8"))["glyphs"] == os.path.join(dest, "data", "glyphs.json"),
   "installed skill finds its own file")
code, out, err = run("install", "--glyphs", os.path.join(tmp, "broken.json"), "--dest", os.path.join(tmp, "x"))
ok(code == 2 and not os.path.exists(os.path.join(tmp, "x")), "install with a wrong file changes nothing")
zp = os.path.join(tmp, "skill.zip")
code, out, err = run("package", "--glyphs", fx, "--out", zp)
names = zipfile.ZipFile(zp).namelist() if code == 0 else []
ok({"my-handwriting/SKILL.md", "my-handwriting/scripts/my_handwriting.py", "my-handwriting/scripts/fallback_font.json",
    "my-handwriting/data/glyphs.json"} <= set(names), "package zip: %s" % names)

# 7. files of the old name / old version are read
v1 = json.load(open(fx, encoding="utf-8"))
v1["format"] = "handschrift-glyphs"
v1["settings"] = {"target": 3}
v1path = os.path.join(tmp, "v1.json")
json.dump(v1, open(v1path, "w", encoding="utf-8"))
code, out, err = run("check", "--glyphs", v1path, "--json")
ok(code == 0 and json.loads(out)["scripts"] == ["de"], "old file (handschrift-glyphs, v1.0) = German")
bad = dict(v1, format="something-else")
json.dump(bad, open(os.path.join(tmp, "bad.json"), "w", encoding="utf-8"))
code, out, err = run("check", "--glyphs", os.path.join(tmp, "bad.json"))
ok(code == 2 and "Unknown file format" in err, "unknown format is refused")

# 8. PDF structure
pdf = open(os.path.join(tmp, "out.pdf"), "rb").read()
sx = int(pdf.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
ok(pdf[sx:sx + 4] == b"xref", "pdf startxref")

# 9. several handwritings in one skill (data/glyphs.json + data/glyphs-<name>.json)
dest2 = os.path.join(tmp, "skills2", "my-handwriting")
run("install", "--glyphs", fx, "--dest", dest2)
oma = json.load(open(basic, encoding="utf-8"))
oma["name"] = "Oma Érika"
omap = os.path.join(tmp, "oma.json")
json.dump(oma, open(omap, "w", encoding="utf-8"))
code, out, err = run("install", "--glyphs", omap, "--name", "Oma Érika", "--dest", dest2)
ok(code == 0 and os.path.isfile(os.path.join(dest2, "data", "glyphs-oma-erika.json")), "install --name: %s %s" % (out, err))
inst2 = os.path.join(dest2, "scripts", "my_handwriting.py")
p = subprocess.run([sys.executable, inst2, "info"], capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
info = json.loads(p.stdout.decode("utf-8"))
ok([h["name"] for h in info["handwritings"]] == ["default", "Oma Érika"] and info["handwritings"][0]["default"], "info lists handwritings: %s" % info.get("handwritings"))
p = subprocess.run([sys.executable, inst2, "render", "--profile", "oma erika", "--text", "Hi", "--out", os.path.join(tmp, "oma.svg"), "--json"],
                   capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
ok(p.returncode == 0 and json.loads(p.stdout.decode("utf-8"))["glyphs"].endswith("glyphs-oma-erika.json"), "render --profile picks the other handwriting")
p = subprocess.run([sys.executable, inst2, "render", "--profile", "nobody", "--text", "Hi", "--out", os.path.join(tmp, "n.svg")],
                   capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
ok(p.returncode == 2 and b"Oma" in p.stderr, "unknown --profile lists the available ones")

# 10. the web app's ZIP (js/zip.js + js/skill-bundle.js) works as a skill
bundle_js = open(os.path.join(ROOT, "js", "skill-bundle.js"), encoding="utf-8").read()
spec = __import__("importlib.util").util.spec_from_file_location("bsb", os.path.join(ROOT, "tools", "build_skill_bundle.py"))
bsb = __import__("importlib.util").util.module_from_spec(spec)
spec.loader.exec_module(bsb)
fresh = bsb.bundle()
try:
    shipped = node("console.log(JSON.stringify(require(process.argv[1])))", os.path.join(ROOT, "js", "skill-bundle.js"))
    ok(shipped == fresh, "js/skill-bundle.js is up to date (run tools/build_skill_bundle.py)")
    zpath = os.path.join(tmp, "web-skill.zip")
    subprocess.run(["node", "-e", """
const fs=require('fs'), Z=require(process.argv[1]), B=require(process.argv[2]);
const g=fs.readFileSync(process.argv[3],'utf8'), o=fs.readFileSync(process.argv[4],'utf8');
const files=Object.keys(B.files).map(k=>({name:'my-handwriting/'+k,data:B.files[k]}));
files.push({name:'my-handwriting/data/glyphs.json',data:g},{name:'my-handwriting/data/glyphs-oma-erika.json',data:o});
fs.writeFileSync(process.argv[5], Z.build(files));""", os.path.join(ROOT, "js", "zip.js"), os.path.join(ROOT, "js", "skill-bundle.js"),
                    fx, omap, zpath], check=True, capture_output=True)
    zf = zipfile.ZipFile(zpath)
    ok(zf.testzip() is None, "ZIP from the browser: CRCs ok")
    _lic = lambda t: t.replace("\r\n", "\n").strip()
    ok("my-handwriting/LICENSE" in zf.namelist() and _lic(zf.read("my-handwriting/LICENSE").decode("utf-8"))
       == _lic(open(os.path.join(ROOT, "LICENSE"), encoding="utf-8").read()), "the skill ZIP carries the MIT license (same as LICENSE)")
    ok(_lic(open(os.path.join(ROOT, "skill", "my-handwriting", "LICENSE"), encoding="utf-8").read())
       == _lic(open(os.path.join(ROOT, "LICENSE"), encoding="utf-8").read()), "skill/my-handwriting/LICENSE equals LICENSE")
    xdir = os.path.join(tmp, "unzipped")
    zf.extractall(xdir)
    zf.close()
    xs = os.path.join(xdir, "my-handwriting", "scripts", "my_handwriting.py")
    p = subprocess.run([sys.executable, xs, "info"], capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
    info = json.loads(p.stdout.decode("utf-8"))
    ok(p.returncode == 0 and info["ready"] and len(info["handwritings"]) == 2, "unzipped skill is ready: %s" % info.get("handwritings"))
    p = subprocess.run([sys.executable, xs, "render", "--text", "# Hi\n- a", "--markdown", "--out", os.path.join(tmp, "z.pdf"), "--json"],
                       capture_output=True, env=dict(os.environ, MY_HANDWRITING_LANG="en"))
    ok(p.returncode == 0 and os.path.getsize(os.path.join(tmp, "z.pdf")) > 500, "unzipped skill writes a PDF")
except (OSError, subprocess.CalledProcessError) as e:
    print("note: node not available, web ZIP test skipped (%s)" % e)

print(("FAILED %d" % fails if fails else "OK") + " - %d checks (files in %s)" % (checks, tmp))
sys.exit(1 if fails else 0)
