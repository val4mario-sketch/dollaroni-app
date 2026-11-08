# Dollaroni changelog

Versions follow `MAJOR.MINOR.PATCH`. The current version and its notes are in `version.json`:
to publish a new one use `python tools/release.py <version> "note" "note"` (it updates both files).

## 0.6.0 – 08/11/2026
- The interface, messages and documentation are now in English.
- Brumoth understands questions in English as well as Italian.

## 0.5.1 – 01/11/2026
- Unsaved work is protected: before replacing a project the app asks for confirmation and keeps a copy that can be recovered from the start screen. It also warns you when you close the page.
- When saving to a file, the app warns you if someone else has changed the file in the meantime.
- New checks on the accounts: negative values, duplicate ids, forgotten zero-cost items, carbon in manual items outside Table 2, foils without a group.
- The 2027 discount warning also shows the total and margin without discounts. Damaged project files are rejected with a clear message.

## 0.5.0 – 26/10/2026
- Brumoth, the Dollaroni assistant: the little boat at the bottom right (with the "Ask Brumoth!" bubble) opens a chat that answers about the open project (budget, carbon, rankings, simulations, rules) using the numbers calculated by the app.
- Brumoth can change the project (add fibre to a part, items, new parts, catalogue materials, change fibre, delete a part), always showing first what changes and the effect on budget and limits, with Apply / Cancel. If a request is too generic it says so and asks what is missing. It also explains step by step how to do things in the app.
- Brumoth has two modes, chosen from the menu under the chat: Instant (immediate answers from the data) and Complete (the local AI rewrites the answer in its own words, taking from half a minute to a few minutes). The AI runs in the browser, is downloaded once and then works offline.
- Updates: a "New version available" notice with the release notes, also for people using Avvia Dollaroni.bat, and one-click updating.

## 0.4.0 – 28/09/2026
- 2027 rules (budget under 10,000 SM$, Performance Rating, S2 waste, used parts at a price), app installable from GitHub Pages.

## 0.3.0
- S1 → S2 transition: freeze S1, comparison, S2 export.

## 0.2.0
- Interface: overview, laminated parts, cost items, checks, catalogue, S1 export.

## 0.1.0
- Calculation engine: official catalogue and Layup Calculator, costs, carbon limits, masses.
