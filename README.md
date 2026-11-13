# Dollaroni – SuMoth Dollars for the Sapienza Foiling Team

An app that calculates the boat's SuMoth Dollars (SM$) and automatically produces the files in the format required by the SuMoth
Challenge. You work in a convenient internal view; when needed, one button fills in the official templates.

**Version 0.7.0.** It includes the calculation engine, the 2026 data, the interface, "Export S1", the S1→S2 transition with comparison and "Export S2",
the **2027 rules**, **Brumoth**, the assistant with local AI (the little boat at the bottom right) and **update notices** for every PC.
The 2027 rules use the **SuMoth Agora library** (prices and resin fractions, `data/official/2027_SuMoth_Agora_library.json`). Still missing: saving to Google Drive.

## How to use it

1. Double-click **`Avvia Dollaroni.bat`**: the browser opens at http://127.0.0.1:8765/. Python is required; close the black window to shut it down.
2. On the start screen choose one of these:
   - **New 2027 boat**: start from scratch.
   - **New boat from Meravijosa S1 2026**: the same parts and items, to be updated.
   - Open a `.dollaroni.json` file, or look at the 2026 examples.
3. The sections on the left:
   - **Overview**: where the dollars go, Table 2 carbon limits, §2.5 masses, things to fix.
   - **Laminated parts**: one part corresponds to one Layup Calculator sheet.
     - For each substack choose fibre, matrix, process, area, number of plies and areal weight, with the origin (expired −50%, surplus −25%, upcycled).
     - Masses and costs are calculated as you type.
     - There is a preview of how the official sheet will look.
   - **Cost items**: everything else (moulds, consumables, hourly processes, MSRP hardware, Table 3 used parts, upcycled elements), divided into the 7 categories of the S2 template. Grey rows come automatically from the parts.
   - **Checks**: errors and things to verify, with a "Go" button that takes you to the point to correct.
   - **Price list**: the official 2026 price list and the items added by the team (MSRP, prices given on Discord, always with the source).
   - **Export S1**: one click produces three things, downloadable one by one or all in a zip:
     - the completed official Layup Calculator, one file per part;
     - images of the tables for the appendix;
     - a Word/Google Docs document with all the tables.

     Each table also has a "Copy for Google Docs" button.
4. **Save** (Ctrl+S) writes the project file. In the meantime a copy is saved automatically in the browser anyway.
5. Ctrl+Z / Ctrl+Y undo and redo any change.

## Brumoth, the assistant with local AI

At the bottom right is a **little boat** (a Moth on its foils): that is **Brumoth**. When you enter the app the bubble
"Ask Brumoth!" appears, and it goes away as soon as you scroll or touch somewhere else (clicking it opens the chat).
The chat answers about the open project, and understands both English and Italian. It handles questions such as how much budget is left, how much carbon would use up
the budget, where there is too much carbon, a cost ranking, "what if" simulations (a different fibre on a part, 2 kg more carbon in the
hull), how to save money, what needs fixing, what the rules say about discounts, and what changed since S1.

**Two modes**, chosen from the drop-down menu under the chat box (like choosing a model in AI apps):
- **Instant** (the default): the Dollaroni engine answers with the calculated numbers, **immediately** and always exactly;
- **Complete**: after the answer from the data, the local AI rewrites it in its own words. It takes as long as it needs
  (from half a minute to a few minutes on laptops); under the answer you can see how long it has been working.
  If the laptop is on battery, "On battery: slower" appears, because Windows can slow the processor by as much as half.

How it works (in two layers, so the numbers are always right):
1. **Answer engine** (`src/engine/assistant.js`): works out the topic from keywords, identifies parts and materials, and prepares
   the "facts" with the numbers calculated by Dollaroni (the same as in Overview, Checks and Layup Calculator).
   It also runs the simulations (changing a part's fibre, adding material) and calculates savings ideas.
   This is the answer in Instant mode and it is always available, even without AI.
2. **Brumoth's local AI** (`src/ai/llm.js`, Complete mode only): a small language model (Qwen, Apache 2.0 licence)
   that runs **inside the browser** with llama.cpp in WebAssembly (the wllama library). It receives the facts and explains them in words; it calculates nothing.
   If it writes a number that is not among the facts, "To check" appears under the answer. "Data used" shows the starting facts.

**Project changes (always with Apply / Cancel).** Brumoth can also change the project data: add 2 kg of carbon to the hull (new substack),
put 20 kg of MDF in the hull (new item), create a new part, add a material to the price list with its price and density, change the fibre
of a part, or delete a part.
It never changes anything by itself: it shows a card with what changes, the total and margin after the change, and any new problems
(for example a carbon limit exceeded), with **Apply** and **Cancel**; after applying there is "Go back" (like Ctrl+Z).
"What if" simulations that can be applied also offer the card. If the request is too generic (just "add carbon")
it says so and asks what is missing (quantity, part, price, density…). Brumoth changes the **data**, not the app: new pages and functions are development work.

**Instructions.** "How do I…" questions get the steps with the real button names (parts, new materials, items, export, S1→S2,
saving, waste, Performance Rating, updates) and, where possible, the card to do it right away. Changes and instructions
do not go through the AI: they are fixed texts from the engine (`src/engine/actions.js`), so they are exact even on a slow PC.

The model (Complete mode):
- is downloaded **only once** from Hugging Face the first time "Complete" is chosen (or when the app opens, if set
  in Brumoth's ⚙ settings), and then stays on the PC, in the browser storage for that address: it also works offline;
- **Standard** (Qwen3.5 2B, about 1.3 GB): better answers, CPU only, 2-4 minutes on a laptop; **Light** (Qwen3 0.6B,
  about 0.4 GB): about 25 s with a graphics card, but gets numbers wrong more often. Choose and delete models from the ⚙ settings;
- the graphics card (WebGPU) is on by default only for the Light model: with larger models, integrated Intel graphics hang.
  It can be turned on or off from the settings; if it gives an error Brumoth restarts by itself without it;
- when the chat opens in Complete mode the model loads and reads the instructions once, and they stay in memory:
  for each question it reads only the data and the question;
- it uses **multiple cores** only if the app is opened from "Avvia Dollaroni.bat" or the installed site (it needs cross-origin isolation, see below);
- everything stays on the PC: questions and project data are not sent to anyone.

## Updates for the whole team

Each PC knows which version it has (`version.json`) and checks whether a newer one exists **on opening, every 30 minutes and when you return
to the window**. If there is one, **"Dollaroni x.y.z is available"** appears at the bottom with the list of changes and the **"Update now"** button;
if notifications are allowed, a Windows notification also arrives. After updating, the "What's new" window appears once.
At the bottom of the sidebar are the version, "What's new" and "Check".

It works in both ways of using the app:
- **published site** (GitHub Pages, also installed as a program): the service worker downloads the new version and "Update now" activates it;
- **locally** with "Avvia Dollaroni.bat": the local server compares `version.json` with the one in the GitHub repository; "Update now"
  downloads the branch zip and replaces the app files. It first copies the old ones to `out/backup-<version>-<date>/`.
  It never touches `out/`, the `*.dollaroni.json` files or "Avvia Dollaroni.bat". If the folder is a git clone, it runs `git pull --ff-only`.
  If `tools/devserver.py` has also changed, it asks you to close and reopen the .bat.

Configuration is in `dollaroni.config.json` → `updates.repository`, for example `"sapienza-foiling-team/dollaroni"` (a **public** repository).
While it is empty, the local check is off (in a git clone the repository is read from the `origin` remote).

**Publishing a new version** (every PC then sees the notice):
1. `python tools/release.py 0.6.0 "First change" "Second change"` updates `version.json` and `CHANGELOG.md`;
2. commit and push to `main`: GitHub runs the tests (`tools/run_tests_headless.py`) and, if they pass, publishes to Pages.

Note: the automatic save in the browser (and the AI model) apply only to that address. The `.dollaroni.json` files remain the copy to share.

## From S1 to S2

1. Once S1 has been submitted: **Overview → "Freeze S1 and create S2"** (also at the bottom of "Export").
   - S1 is saved inside the project as a fixed reference (`baseline`).
   - The project becomes S2, with the same parts and items marked "estimated".
   - The first Save asks for a new file, so the S1 file stays intact.
2. During construction, update each item and part to its real value, then click **"estimated" → "✓ measured"**.
   - Parts also have the **real weighed weight**: it is used for the 2.4 self-assessment.
   - Under each total you can see the value it had in S1.
3. **S1→S2 comparison**:
   - differences by component: this is the 2.3 comparison table;
   - differences item by item, from the largest;
   - S1 masses, S2 calculated and weighed masses;
   - how much of the cost has already been measured.
4. **Export S2** produces:
   - the document with the 2.2 tables (one per component, with notes on discounts and the summary);
   - the 2.3 tables (total and comparison with S1);
   - supporting data for 2.4 and the as-built mass breakdown;
   - the Layup Calculator and the images of the as-built parts.

   The texts (2.1, explanations in 2.3, 2.4 self-assessment) are written by the team.
5. If an S2 project does not contain S1 (for example, created by hand), the submitted S1 file can be linked from "S1→S2 comparison".

## 2027 rules

Each project states which rulebook it uses (the `rules` field; old files without the field are 2026). New projects start with the 2027 rules;
a 2027 project created earlier with the 2026 rules shows the **"Switch to the 2027 rules"** button in Overview. The "Rules 2026/2027" badge is always at the top.

What changes with the 2027 SMC Competition Rulebook v1.0 (7 September 2026):
- **Budget**: must be kept *under* 10,000 SM$; exceeding it costs 500 points (§10.1).
- **Table 2** (carbon): same limits as 2026, "Wingbars" becomes "Hiking racks".
- **Price list and laminate calculation**: from the SuMoth Agora library (agora.sumoth.org/library.json, a copy in `data/official/`; update it with `python tools/update_agora_library.py`, then run the tests). Resin = fibre × r/(1−r), with r the resin mass fraction of the process for the fibre family (e.g. hand layup + vacuum: carbon 0.50, basalt 0.40), as Agora does. A prepreg (selectable as the fibre of a substack) pays fibre and resin at its prepreg price; a core at one of Agora's standard densities gets its resin absorption automatically. There is no Layup Calculator file in 2027: the export keeps the layup tables as images. 2026 items keep their ids, so projects made from 2026 ones keep working.
- **Origin discounts** (−25/−50/−100%): the 2027 rulebook no longer mentions them, but Agora applies them per row, so Dollaroni does too.
- **Used parts**: the fixed cost of the old Table 3 is gone. They are entered as "Used or commercial part" with the price (from Agora) and the year of production.
- **Performance Rating** (new Table 3, §11): in the section of the same name, tick conditions a)–g) for the 15 components; commercial sails, masts and foils produced since 2017 are worth −100 each (§11.1.5), barring compromising damage. The rating also goes into the exports.
- **S2 waste** (§9.2.2): in laminated parts (extra material consumed, added to quantity and cost) and in item details ("of which waste"). "Material use and waste" table in the S2 export.
- **Upcycled hull** allowed only if it originally came from a non-foiling boat (§6.2.1): a reminder in the checks.
- The as-built mass breakdown is no longer required (it stays as a useful table); the 2027 exports do not use the 2.1–2.4 numbering of the 2026 S2 template.

## What is in the engine

- **Import of official files** (`src/io/official.js`)
  - Price list `20xx_SMC_Standardized_Costs.xlsx`: the items become the price catalogue. It flags materials without a price and duplicates.
  - Template `20xx_SMC_Composite_Layup_Calculator.xlsx`: materials, densities, processes and Vf are read from the file itself.
  - When the new year's files come out, just replace them in `data/official/`.
- **Layup engine** (`src/engine/layup.js`): uses the same formulas as the official Layup Calculator, without the limit of 5 substacks.
- **Costs** (`src/engine/project.js`):
  - price-list items and hourly processes;
  - hardware at MSRP;
  - §3.3 origin discounts: industrial surplus −25%, out of shelf life −50%, upcycled −100%;
  - Table 3 used parts, with fixed cost and handicap;
  - totals by component of the S2 template, budget margin, Table 2 carbon limits and §2.5 mass breakdown.
- **Checks** (`src/engine/checks.js`):
  - budget;
  - carbon over or close to the limit;
  - declared quantities that differ from the layup;
  - materials that do not exist in the official calculator;
  - prices without a source;
  - upcycled items without a stated origin.
- **Report tables** (`src/engine/reports.js`):
  - S1: "SuMoth Dollar breakdown" table;
  - S2 §2.2: one table per component, with automatically generated notes on discounts;
  - S2 §2.3: summary and S1→S2 comparison;
  - mass breakdown.
- **Layup Calculator export** (`src/io/layup-export.js`): **one file per part** (Hull, Wing panel, Main vertical…).
  - It starts from a copy of the official template and changes only the input cells. Formulas, menus and styles remain the organizers'.
  - Unused substacks are hidden.
  - A part with more than 5 substacks is split into "Part (1/2)", "Part (2/2)".

## Checks done on the 2026 data

The two projects in `data/projects/` are Meravijosa S1 and S2 2026, reconstructed from the submitted reports.

| Check | Result |
|---|---|
| S1 Appendix G (8 parts, every substack) | matches to the gram |
| S1 Table 2 | 8,422.44 SM$, matches |
| S2 Tables 2.1–2.9 (7 components) | 9,955.88 SM$, matches to the cent |
| Table 2.10 (S1→S2 comparison) | Δ and changes match |
| Exported files recalculated by LibreOffice with the official formulas | maximum difference 1e-15 |

What the checks flag on the 2026 data:
- S1: the main horizontal has **1000.04 g of CFRP against the 1000 g** allowed by Table 2, so it exceeds it by 0.04 g. The main vertical is at 98.7% of the limit.
- S2: the hull resin is declared as 1.44 kg, but the Layup Calculator (Vf 35%) gives 2.35 kg (−39%). The budget margin is 44.12 SM$.

## Publishing (GitHub Pages)

The repository contains the `.github/workflows/pages.yml` workflow: on each push to the `main` branch GitHub
runs `python tools/build_pwa.py _site` and publishes the folder. The script copies only the app files
(no `out/`, internal notes or `*.dollaroni.json` project files, which are also excluded by `.gitignore`) and writes into `sw.js`
the version (a fingerprint of the files) and the list of files to keep offline.

First time: in the repository settings, Pages > Source: **GitHub Actions**. The site will be at
`https://<account>.github.io/<repository>/`. Then write the repository in `dollaroni.config.json` (see "Updates").

Before publishing, the workflow runs `python tools/run_tests_headless.py`: if a test fails, the version is not published.

**Cross-origin isolation.** The local server sends the headers `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; on GitHub Pages the service worker adds them (from the second opening onwards).
The AI needs them to use multiple cores. A side effect to remember: login popups from other sites (e.g. Google) cannot
communicate with the page, and iframes from other sites must be loaded with `credentialless`. The server can be started with `--no-isolation`.

To try the installable app locally (the service worker is normally off locally):

```bash
python tools/build_pwa.py out/site
python tools/devserver.py 8766 --root=out/site
```

and open http://127.0.0.1:8766/?pwa. The icons can be regenerated with `python tools/make_icons.py`.

## How to run the tests

Only Python is needed (no Node installation).

```bash
python tools/devserver.py
```

Then open http://127.0.0.1:8765/tests/ in the browser: it should report that all 81 tests pass.
The tests also save the Layup Calculator xlsx files in `out/layup-s1/`.

Without opening any windows (uses Chrome or Edge in headless mode, as GitHub does before publishing):

```bash
python tools/run_tests_headless.py
```

To recheck them with the official formulas, through LibreOffice:

```bash
python tools/verify_layup_export.py out/layup-s1
```

## Structure

```
index.html         the app
Avvia Dollaroni.bat double-click start (local server + browser)
version.json       installed version and notes (compared by the update check)
CHANGELOG.md       version history
dollaroni.config.json  GitHub repository to update from
styles/app.css     styling
src/app/           interface (Preact + htm, no build): app.js, views/ (including assistant.js, Brumoth: boat, bubble and chat), store.js, updates.js, pwa.js
src/ai/            Brumoth's local AI in the browser (llm.js: download, cache, start-up, streaming answers)
src/engine/        rules by year (rules.js, rules-2026.js, rules-2027.js), layup calculation, costs, Performance Rating, checks, report tables,
                   assistant.js (Brumoth's answer engine)
src/io/            xlsx reading/writing, import of official files, template export, docx, images
data/official/     official SuMoth files (2026 price list and Layup Calculator, 2027 SuMoth Agora library)
data/projects/     example projects (Meravijosa S1 and S2 2026)
tests/             browser tests (golden tests on the 2026 data)
tools/             local server (with updates), headless tests, release.py, LibreOffice check, site build (build_pwa.py), icons
sw.js, manifest.webmanifest, icons/   installable app (service worker, manifest, icons)
.github/workflows/ publishing to GitHub Pages
vendor/            JSZip 3.10.1 (MIT), htm 3.1.1 + Preact (MIT), wllama 3.8.1 (MIT, llama.cpp in WebAssembly)
```

## Project format (`dollaroni/1`)

```jsonc
{
  "schema": "dollaroni/1", "name": "Meravijosa", "season": 2026, "stage": "S1", "concept": "NEW",
  "catalogExtras": [ { "id": "hw-blocks", "name": "Blocks", "unit": "pc", "price": 32.5, "priceSource": "MSRP Harken" } ],
  "parts": [ {
    "id": "hull", "name": "Hull",
    "component": "hull",          // S2 category: hull, foils, mechanical_control, gantry, wingbars, rig, electronics
    "limitGroup": "hull",         // Table 2 column for the carbon limits
    "massGroup": "hull",          // §2.5 mass breakdown row: hull, wings, horizontal_foils, vertical_foils
    "autoLines": true,            // true = the fibre/resin/core cost rows are generated automatically
    "substacks": [ { "reinforcement": "dry-fabric-basalt-fibers", "matrix": "std-epoxy/lamination-resin",
                     "plyArea": 3.997, "plies": 4, "arealWeight": 340, "process": "HAND LAYUP + VAC",
                     "matrixSource": "out_of_shelf_life" } ],
    "core": { "ref": "pet/recycled", "mass": 0.72, "resinUptake": 250, "area": 2.0 }
  } ],
  "lines": [ {
    "id": "hull-mould", "component": "hull", "name": "Hull - mould", "s2Label": "MDF (mould blocks)",
    "material": { "ref": "mdf-hdf-wood", "qty": 110, "source": "new" },
    "process":  { "ref": "machining", "hours": 30, "s2Label": "CNC Machining (mould milling)" }
  }, {
    "id": "foil-mv", "component": "foils", "name": "Main Vertical", "usedPart": { "element": "main_vertical", "year": 2014 }
  } ]
}
```

- **`source`** (origin):
  - `new`
  - `industrial_excess` (−25%)
  - `out_of_shelf_life` (−50%)
  - `upcycled` (−100%): the origin must be stated in `origin`.
- **Recycled materials** have their own price-list item, for example `pet/recycled` at 0 SM$.
- **Quantities to check against the layup**: `"check": {"parts": ["hull"], "kind": "fibre" | "resin" | "core"}`.

## Next steps

0. When Agora publishes a new library: `python tools/update_agora_library.py`, tests, and update the 2027 golden values if prices change.
1. Shared saving on Google Drive with Google login, merging changes made by several people.
2. Check the imported documents in Google Docs.
