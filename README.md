## Idea
The protocol system is meant for multiple purposes and rust code should combine all of them.

## Purposes
### Material tracking (data)
I want to have files which describe all materials that are in storage:
- How much is in stock
- What concentrations are available
- Is it a liquid
- What are the dangers when dealing with it
- How much does it cost
- Where can you order more
- Where is the material located
- For what can it be used for
- This organism has those components which interact this way

The **implementation** of basic material is straight forward and not discussed further. Composed material such as M9 medium is also relatively straight forward as you would simply take the meta material, use an instruction, and the output will be this medium at a certain concentration.
The actual difficult part is organisms. How can an organism be modelled to predict its behaviour as accurately as possible.

Using https://pubchem.ncbi.nlm.nih.gov/ as a chemical library. Using cas, you get the cid number using:
1. `curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{cas number}/cids/JSON" | jq '.IdentifierList.CID[0]'`
2. Use the number to grab data using `curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{CID number}/property/MolecularFormula,MolecularWeight,CanonicalSMILES/JSON"`

### Instructions (functions)
For each device I want to have instructions of how to use it and what is required. These can be seen as functions with exact steps. Either they can be performed manually or automatically by the biomation system. The goal is to have those instructions for any kind of use in any situation. During the process I also want to know what to expect, so what is going on under the hood in real time. So in experiments it would help to know when something should be seen, what to expect and when.
Instructions could be:
- **Move solutions around**:
    - **transfer**: Moving liquid between containers
    - **add**: Introducing a stock reagent, which triggers a recalculation of chemical state
    - **distribute**: Dispensing into multiple destination wells from a single large volume
    - **consolidate**: Collecting liquid from multple source wells into a single target vessel
- **mix**: Homogenizing through pipetting, stirring, vortexing, or shaking
- **centrifuge**: separate solutino into pellets and supernatant (or by density)
- **temperature control**:
    - **incubate**: Maintaining a stable temperature
    - **on_ice**: Rapid cooling to halt enzymatic activity and preventing degration
    - **heat_shock**: Precise timed temperature spike for organisms to take foreign nucleotides
    - **run_pcr**: Thermal cycles for nucleotide amplification
- **pick_colonies**: Identifying and pick colonies
- **adjust_ph**: Adding acid or base to get exact pH level
- **other**: manual, checkpoint 

As a side note the functions also have a global scope of basic variables like the room temperature, humidity, and facility at which it took place.

### Documentation (log)
The chronological events that took place with what material through which instructions lead to this result. This can't be done fully through code but the whole process description could be fully automated into natural language. So for each function the types must be logged. Either you have a continuous text format that completes over time, or you do it all at once.

## Features
- Protocol creation:
    - Web interface
- Protocol parsing:
    - 
- Protocol processing:

---

## Warehouse interface: progress and thoughts

_2026-11-15. The Rust / Dioxus interface was replaced by a plain JavaScript / HTML / CSS project
(no build step, no npm install). What has to be built on the warehouse side is in
[required.md](required.md)._

### Run it

```
node serve.mjs            # http://127.0.0.1:8080, proxies /api/* to the warehouse on :3210
node serve.mjs --mock     # same, but /api/* is answered by the built-in simulator
node serve.mjs --host 0.0.0.0 --warehouse http://192.168.0.6:3210   # phone on the LAN, other warehouse
```

The page waits for the warehouse and enters once it answers. The warehouse cannot serve what the
interface needs yet (no state snapshot), so for now use **Run simulation** on the start screen, or
open `http://127.0.0.1:8080/?sim`. `index.html` has to be served over HTTP (ES modules), opening the
file directly does not work.

### What is there

- **3D world** (three.js, vendored in `vendor/`): endless Skådis board, conveyors, lift, pipetter,
  cargo and every single container (tube, well, tip, dish) at their database positions. Liquids are
  tinted by material, hazards get a marker, belts and the lift show moving chevrons, moving cargo
  shows direction arrows and a ghost of where the current move ends.
- **Game controls**: WASD / drag to move, QE RF to turn and tilt, wheel / pinch to zoom, click to
  select. The camera focuses and tracks the selection and returns when you click away. Touch works
  (pan, pinch, twist, orbit toggle); panels become sheets on a phone.
- **Layers** (keys 1 to 5): normal, labeled (contents under each cargo), touch (anchored cargo and
  its home slot), prediction (scrub or play time forward, ghosts and trajectories), setup (models
  and offsets per element).
- **Operations panel**: what runs now, what comes next, time left, and whether and when a manual
  intervention is coming. Manual tasks show a banner, a beacon on the container in 3D, accept / done.
- **Protocol browser** with a generated emblem per protocol, time estimate, run / preview / edit.
- **Protocol editor** without syntax: step cards with 3D portraits of the cargo, material,
  concentration, hazards and volume before → after; containers are picked from a top-down map, a
  "same material" quick list, or by clicking them in the 3D view; amounts are dragged. Saves to the
  warehouse.
- **Cargo bay**: take cargo out of the system, return it, add a new cargo from a collection
  (falcon racks, well plates, tip box, petri dish).
- **Prefab workshop** (separate 3D view): combine STL files from `models/` (or dropped into the
  browser) with boxes, cylinders, conveyor references ("going through" or "edge") and container
  collections; assign the prefab to an element and it replaces the rectangle.
- **Themes**: four for the interface and four for the world, independent of each other.
- **Configuration**: themes, prefabs, model-per-element-id, offsets and learned speeds are kept in
  the browser and can be exported / imported as one JSON file (Settings).

### How it is built

- `js/shared/`: material math, kinematics and container collections. Used by the client *and* the
  simulator, so the prediction and the simulated warehouse cannot disagree about how a belt moves cargo.
- `js/sim/`: an in-process warehouse that implements the API of `required.md`. The browser calls it
  directly; `serve.mjs --mock` puts the same object behind real HTTP + SSE. There is one API client
  for both, so the HTTP path is exercised too.
- `js/core/store.js`: snapshot polling + SSE. Like the real runtime, positions only change in the
  database when a move completes; in between, the store animates the move from its predicted
  duration and eases into the confirmed position, so nothing jumps when the prediction was off.
- Speed learning: starts at 30 ms per mm for belts and lifts (10 for the pipetter), then fits `time = start-up + rate · distance` per motor
  kind (belt x, lift y, pipetter) from every finished move, weighting recent moves more.
- `js/core/predict.js` replays the runtime's scheduling rule (dependencies, one batch per grbl
  board) to get the time estimate and the prediction layer.

### Checked, and not checked

- Checked in headless Chromium against the simulator, both in-browser and over HTTP through
  `serve.mjs --mock`: full protocol runs including a manual step, creating a protocol through the
  editor UI, prefab with an STL assigned to a cargo, cargo take-out / return / add, all layers,
  the four themes, a phone-sized viewport.
- **Not checked against the real warehouse or hardware.** Only `/status`, `/listen`, `/protocol/run`,
  `/protocol/can_run` and the manual accept / complete calls exist there today.
- Frame rate was only measured with software rendering; on a slow machine the "auto" quality drops
  bloom by itself.

### Thoughts and open ends

- The simulator's planner is a simple stand-in (everything travels via the lift on the left, cargo
  is parked back on a shelf after a run). It exists to make the interface testable, it is not the
  navigation logic of the warehouse.
- Volumes use the same estimate as `protocol_lib` (heaviest substance / its density), so a 70 %
  ethanol mix reads lower than it is. Kept on purpose so the interface and the matcher agree.
- Guesses about geometry that the database does not hold yet (cargo depth, belt depth, container
  origin, pipetter axes) are listed at the end of `required.md`.
- Only transfer steps exist, as in the database. The editor is built so more step kinds from the
  list above can be added as further card types.
- The old Rust sources (`src/`, `Cargo.*`, `Dioxus.toml`, `web_assets/`, `target/`) were removed as
  suggested; nothing was committed and `.gitignore` was left alone (it still ignores `models/`).

### Manual control and pause

- **Pause** (`P`, or the button in the operations panel): the warehouse starts no new instruction
  until resumed; running moves finish. A banner and a gold frame around the view show it, and the
  queue reads "paused". The state comes from the warehouse (`paused` in the snapshot).
- **Manual control** panel (`G`, the dock, or "Move …" in the inspector), in `js/ui/control.js`:
  - *Conveyor:* ← → choose a belt distance, ↑ ↓ a lift distance (Shift ×10, Alt ×0.1, or drag
    the track). The track shows the permitted range, ghost boxes show where the cargo will stand,
    Enter sends the move.
  - *Cargo:* ← → move the target along the belt, ↑ ↓ switch to the conveyor above / below, or click
    a belt in 3D to aim there. A ghost marks the target (red when over the edge or colliding).
    Enter = "Drive there" (the warehouse plans the way and moves other cargo aside), Shift+Enter =
    "Set position" (corrects the record only, after a confirmation for the button).
  - Arrow keys steer instead of the camera while the panel is open (WASD still moves the camera).
    Everything is refused while instructions are queued; the warehouse checks every range again.
- Range rules are shared with the simulator in `js/shared/limits.js` (same as `logic/manual.rs`).
- Checked in headless Chromium against the simulator: pause holds a queued move until resume, belt
  and lift moves with arrow keys, clamping at the range limit, aiming by clicking a belt, drive
  there, set position. Not checked against the real warehouse in the browser (the HTTP endpoints
  themselves were tested with curl).
