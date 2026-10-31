# Commonwealth

An idle settlement builder on the web.

*A little at a time. A world together.*

An early browser game prototype about growing a shared economy across specialized settlements. Passive production keeps things moving; active gathering games and idle expeditions help you reach the next upgrade.

## Run locally

No build step or package installation is required. With Python 3 installed:

```sh
git clone https://github.com/CraightonH/commonwealth.git
cd commonwealth
python3 -m http.server 8000 --directory dist
```

Open <http://localhost:8000> in a modern browser. Keep the server running while you play. Alternatively, serve `dist/` with any static web server.

## Play

- Select buildings on the illustrated settlement map to open their controls.
- Establish fishing villages, lumber camps, and mining outposts. Their resources enter one shared stockpile.
- Spend resources on more settlements and workshop tools that improve production across the economy.
- Play fishing, mining, or timber memory games for extra resources. Gathering equipment increases active rewards.
- Equip an expedition, wait for its return, and collect its supplies.

Progress saves in this browser's local storage, with up to eight hours of offline production. Saves are specific to the browser and site origin; there are no accounts or cloud saves. To reset, remove the `hearthwater-v1` local storage entry through your browser's developer tools. The original save key is retained from the prototype's working title for compatibility.

## Source

```text
dist/
  index.html   Settlement scene, building controls, and dialog shell
  style.css    Responsive interface and visual styling
  game.js      Economy, upgrades, gathering games, expeditions, and saves
docs/
  game-concept.md
```

The prototype uses plain HTML, CSS, JavaScript, and inline SVG. Typography optionally loads from Google Fonts, with local font fallbacks. There are no API keys, backend services, or runtime dependencies. For static hosting, publish the contents of `dist/`.

## Prototype scope

This is a proof of concept, not a balanced release. Gathering rounds are short and expeditions take one minute to make the loop easy to try. Expedition combat is currently represented by a timer and fixed rewards. Art, progression, accessibility, and minigame depth are still open for iteration.

The original private hosted sketch was called Hearthwater. This repository adopts the chosen name, Commonwealth; it does not change the existing hosted sketch.

JavaScript syntax can be checked with Node.js:

```sh
node --check dist/game.js
```
