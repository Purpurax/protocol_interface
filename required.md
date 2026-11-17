# API the interface needs from `protocol_warehouse`

The interface talks to the warehouse over HTTP + SSE only. This file lists every call it uses, what
the call has to do, and whether the warehouse has it today.

A complete reference implementation of this contract lives in
[js/sim/warehouse-sim.js](js/sim/warehouse-sim.js) (`route()` is the list of endpoints, `snapshot()`
the state document). `node serve.mjs --mock` serves it over real HTTP, so answers can be compared
with `curl http://127.0.0.1:8080/api/warehouse/state`.

| # | Call | Status in the warehouse | Needed for |
|---|------|-------------------------|------------|
| 0 | JSON answers, error status codes, same origin or CORS | exists (no CORS: use `serve.mjs`) | everything |
| 1 | `GET /status` | exists | boot |
| 2 | `GET /listen` (SSE) | exists | manual tasks, errors, live refresh |
| 3 | `GET /warehouse/state` | exists | the whole 3D view |
| 4 | Extra fields on instructions | partly: `started_at`, `completed_at`, `protocol_run_id`, `pair_with`; `label` is always null | live motion, speed learning, queue |
| 5 | `GET /protocols`, `GET /protocol/{id}` | exists | protocol browser |
| 6 | `POST /protocol`, `PUT /protocol/{id}`, `DELETE /protocol/{id}` | exists (`preferred_container_id` is stored, the planner does not use it yet) | protocol editor |
| 7 | `GET /protocol/plan?id=` | **missing** (answers 404) | time estimate, prediction layer |
| 8 | `GET /protocol/can_run?id=` with reasons | exists, always `true` | run button, editor |
| 9 | `GET /protocol/run?id=` | exists (steps still run in reverse) | running a protocol |
| 10 | `POST /protocol/abort` | exists | abort button |
| 11 | `POST /instruction/manual/accept/{id}`, `.../complete/{id}` | exists | manual tasks |
| 12 | `POST /cargo/{id}/remove`, `POST /cargo/{id}/insert`, `POST /cargo`, `DELETE /cargo/{id}` | exists (409 while any instruction is queued) | cargo bay |
| 13 | `POST /runtime/pause`, `POST /runtime/resume`, `paused` in the state | exists | pause button |
| 14 | `POST /conveyor/{id}/move`, `POST /cargo/{id}/position`, `POST /cargo/{id}/navigate` | exists | manual control |

Without call 3 the interface stays on its start screen ("the warehouse does not offer
`GET /warehouse/state` yet") and offers the built-in simulation instead.

Still open in the warehouse: `label` on instructions (4), `GET /protocol/plan`, and the `reasons` /
`mapping` of `can_run`.

General rules the interface relies on:

- Numbers may be JSON numbers or decimal strings (`"167.0"`); both are accepted.
- Unknown extra fields are ignored; optional fields are marked *(optional)*.
- Timestamps are ISO 8601 (`2026-11-15T12:00:00.000Z`).
- Units as in the database: positions and lengths in mm, volumes in µL, substance amounts in mol.

---

## 0. Transport

- Every answer is valid JSON. Errors use a 4xx / 5xx status and the body `{"error": "why"}`.
- The browser must be allowed to call the warehouse. Either
  - serve the interface with `node serve.mjs` (it proxies `/api/*` to the warehouse, nothing to
    change in the warehouse), or
  - send `Access-Control-Allow-Origin` (and allow `content-type`) from the warehouse.

## 3. `GET /warehouse/state`

One consistent snapshot of the tables the interface draws. It is polled (about 3 times a second
while instructions run, every 1.5 s when idle), so it should be one cheap read.

```jsonc
{
  "revision": 1042,            // (optional) any counter that changes when something below changes
  "server_time": "2026-11-15T12:00:00.000Z",
  "motors":     [{ "motor_id": 1, "grbl_index": 1, "axis": "X", "grbl_value": 0, "last_home": "...", "requires_homing": false }],
  "conveyors":  [{ "conveyor_id": 1, "is_storage": false, "absolute_x": 167, "absolute_y": 122, "x_motor": 1, "y_motor": null, "length_x": 588, "length_y": 0 }],
  "deadzones":  [{ "deadzone_id": 1, "on_conveyor_id": 4, "start_x": 420, "end_x": 470 }],
  "calibrators":[{ "calibrator_id": 1, "conveyor_id": 4, "meant_for_cargo": true, "calibrates_left_x": 0, "calibrates_right_x": null, "calibrates_up_y": null, "calibrates_down_y": null }],
  "pipetters":  [{ "pipetter_id": 1, "on_conveyor_id": 4, "absolute_x": 961, "absolute_y": 1005, "y_motor": 8, "z_motor": 9, "push_motor": 10, "length_y": 220, "length_z": 120 }],
  "cargos":     [{ "cargo_id": 1, "relative_x": 0, "on_conveyor_id": 1, "anchored_conveyor": null, "anchored_relative_x": null,
                   "x_distance_after_last_calibration": 0,
                   "is_available": true,        // new column, see 12
                   "label": "Reagents" }],      // (optional) free text shown next to the id
  "container_types": [{ "container_type_id": 1, "container_type_name": "Falcon 50mL" }],
  "containers": [{ "container_id": 1, "container_type_id": 1, "on_cargo_id": 1, "relative_center_x": 27.5, "relative_center_z": 25,
                   "maximum_volume": 50000, "is_closed": false, "material_id": 1 }],
  "tip_containers": [{ "tip_container_id": 1, "on_cargo_id": 4, "relative_center_x": 18, "relative_center_z": 13.5, "has_tip": true, "is_sterile": true }],
  "materials":  [{ "material_id": 1,
                   "substances": [{ "substance_id": 1, "amount": 2.33 }],   // material_substance rows
                   "proteins":   [{ "protein_id": 1, "amount": 3 }],
                   "organisms":  [{ "organism_id": 1, "amount": 800000000 }] }],
  "substances": [{ "substance_id": 1, "cas_number": "7732-18-5", "substance_name": "Water", "formula": "H2O", "molar": 18.015, "density": 1.0,
                   "hazard": { "flammable": false, "corrosive": false, "toxic": false, "environmental": false, "oxidizer": false } }],
  "proteins":   [{ "protein_id": 1 }],
  "organisms":  [{ "organism_id": 1, "organism_name": "E. coli DH5α" }],
  "instructions": [ /* see 4: every instruction that is not COMPLETED, plus the last ~50 completed ones */ ],
  "run": { "protocol_id": 2, "protocol_name": "Saline dilution row", "started_at": "...", "instruction_count": 125 }  // or null
}
```

Two things matter for the 3D view to be right:

1. **Cargo positions follow the moves.** When an instruction is marked COMPLETED, `cargo.relative_x`
   and `cargo.on_conveyor_id` of the cargo that moved have to be updated in the same transaction as
   `motor.grbl_value` (today only `grbl_value` is updated). Between two completions the interface
   animates the move itself.
2. **`hazard` is resolved**: the flags of the substance's `hazard_class` row, not the id.

## 4. Instructions inside the snapshot

```jsonc
{
  "instruction_id": 77, "is_automatic": true,
  "instruction_status": 2,                  // 0 OPEN, 1 COMPLETED, 2 RUNNING
  "depends_on": [75, 76],                   // instruction_dependency rows
  "automatic": { "instruction_automatic_command_id": 70, "motor_id": 3, "target_value": -153, "speed_feed_rate": 2000 },  // null if manual
  "manual": null,
  "started_at": "2026-11-15T12:00:01.200Z", // new: when it was set to RUNNING (null before)
  "completed_at": null,                     // new: when it was set to COMPLETED
  "pair_with": 78,                          // (optional) the other half of a belt-to-belt transfer; both start together
  "label": "Reagents: onto the elevator",   // (optional) human text for the queue panel
  "protocol_run_id": 12                     // (optional)
}
```

A manual instruction has `"automatic": null` and

```jsonc
"manual": {
  "instruction_manual_command_id": 4, "command": "Open the lid of container 145", "user_accepted": false,
  "task": "open",              // (optional) open | transfer | refill | anything else
  "container_ids": [145],      // (optional) which containers the task is about: they get a beacon in 3D
  "cargo_ids": [6]             // (optional)
}
```

- `started_at` / `completed_at` are what the speed prediction learns from ("a move of x mm takes
  10·x ms" is only the starting point). Without them the interface measures with its own clock,
  which includes the polling delay.
- Without `task` / `container_ids` the interface reads them out of the command text
  (`container <id>`, `cargo <id>`), which works with the text the warehouse writes today.

## 2. `GET /listen` events

The existing events are used as they are: `{"ManualCommand":[id,"text"]}`, `{"Error":"text"}`,
`{"ProtocolFinished":[protocol_id,"name"]}` (defined, but never sent today).

*(optional)* `{"StateChanged": revision}` whenever the snapshot changed. The interface then reads
the snapshot immediately instead of waiting for the next poll, which makes motion start and stop
exactly on time.

## 5. Reading protocols

`GET /protocols` → list for the browser:

```json
[{ "protocol_id": 1, "protocol_name": "Test protocol", "protocol_author": "me", "protocol_version": "0.0.1",
   "protocol_software_version": "0.0.1", "step_count": 2, "container_count": 2 }]
```

`GET /protocol/{id}` → the full protocol (404 if unknown):

```jsonc
{
  "protocol_id": 1, "protocol_name": "Test protocol", "protocol_author": "me",
  "protocol_version": "0.0.1", "protocol_software_version": "0.0.1",
  "containers": [{                              // virtual_container rows
    "virtual_container_id": 0,
    "material": { "substances": [{ "substance_id": 1, "amount": 0.2775 }], "proteins": [], "organisms": [] },
    "internal_temperature": 20, "homogeneous": true,
    "preferred_container_id": 12               // new nullable column, see below
  }],
  "steps": [{ "step_order": 0, "kind": "transfer", "from_id": 0, "to_id": 1, "volume": 1000 }]   // instruction_transfer rows
}
```

`preferred_container_id` is new: the editor lets the user pick the physical container (which tube
of which cargo). The planner should use that container when it is available and still matches, and
fall back to matching by material otherwise. Without the column the choice made in the editor is
lost on save and the editor can only show whatever the matcher picks.

## 6. Writing protocols

- `POST /protocol` with the body of `GET /protocol/{id}` (without `protocol_id`) → `{"protocol_id": 7}`.
  Creates the `protocol`, `material` (+ link rows), `virtual_container` and `instruction_transfer` rows.
- `PUT /protocol/{id}` with the same body → replaces containers and steps of that protocol.
- `DELETE /protocol/{id}` → `{"deleted": 7}`; 409 while that protocol is running.
- 400 with a readable `error` for a step that references an unknown virtual container or has a
  volume ≤ 0.

## 7. `GET /protocol/plan?id=`

A dry run of `execute_protocol`: everything up to, but not including, `db_add_instructions`.

```jsonc
{
  "protocol_id": 2, "can_run": true, "reasons": [],
  "mapping": { "0": 1, "1": 46 },                      // virtual container id -> physical container id
  "instructions": [                                     // same shape as 4, ids are the list index
    { "index": 0, "is_automatic": true, "depends_on": [], "pair_with": null, "label": "...",
      "automatic": { "motor_id": 4, "target_value": 33, "speed_feed_rate": 2000 }, "manual": null }
  ]
}
```

The interface turns this into the time estimate (with the motor speeds it has learned), the number
of manual interventions, and the trajectories of the prediction layer.

## 8. `GET /protocol/can_run?id=`

`{"protocol_id": 2, "can_run": false, "reasons": ["No physical container for virtual container 1"], "mapping": {"0": 1}}`

`reasons` and `mapping` are new. The editor uses `mapping` to show which physical containers an
existing protocol resolves to.

## 9. `GET /protocol/run?id=`

Works today, but the body is assembled by hand and is not valid JSON
(`{"protocol_id":"1","ok":}`). Wanted: `{"protocol_id": 1, "ok": true, "run_id": 12, "instruction_count": 64}`
on success, and a 4xx with `{"error": "..."}` otherwise (409 while another protocol runs, 422 when
no containers match). The interface copes with the current answer by looking for `"error"` in the text.

The protocol steps should run in order (`pop()` currently runs them in reverse).

## 10. `POST /protocol/abort`

Removes every OPEN instruction (and manual ones that wait for the user); moves that are already
RUNNING finish. Answer `{"aborted": 84}`. Needed because one stuck instruction blocks every later
run.

## 12. Cargo: take out, put back, add

New column `cargo.is_available BOOLEAN NOT NULL DEFAULT TRUE`. A cargo that is not available is
ignored by the planner and not drawn on its conveyor.

- `POST /cargo/{id}/remove` → `{"cargo_id": 3, "is_available": false}`.
  409 while a belt is moving or while the running protocol uses that cargo.
- `POST /cargo/{id}/insert` with `{"on_conveyor_id": 5, "relative_x": 140}` (`relative_x` optional:
  the old slot if it is free, else the first free slot) → `{"cargo_id": 3, "is_available": true, "on_conveyor_id": 5, "relative_x": 140}`.
  409 if the conveyor has no free slot.
- `POST /cargo` → `{"cargo_id": 9}`. Creates a cargo with its containers:

  ```jsonc
  {
    "label": "Culture plate", "on_conveyor_id": 5, "relative_x": null, "anchored": false,
    "containers": [{ "container_type_name": "Well 24", "relative_center_x": 19.25, "relative_center_z": 16.05,
                     "maximum_volume": 3400, "is_closed": false,
                     "material": { "substances": [{ "substance_id": 1, "amount": 0.0944 }], "proteins": [], "organisms": [] } }],
    "tips": [{ "relative_center_x": 18, "relative_center_z": 13.5, "has_tip": true, "is_sterile": true }]
  }
  ```

  One entry per single tube / well / tip. `container_type_name` is created if it does not exist.
- `DELETE /cargo/{id}` → removes a cargo that is out of the system, with its containers and materials.

## 13. Pause

`POST /runtime/pause` → `{"paused": true}`, `POST /runtime/resume` → `{"paused": false}`. While paused
the runtime starts no new instruction (automatic or manual); moves that are already running finish
and are recorded. The flag lives only in the running warehouse (not in the database) and is reported
as `"paused"` in `GET /warehouse/state`.

## 14. Manual control

All three answer 409 while any instruction is queued.

- `POST /conveyor/{id}/move` with `{"axis": "x" | "y", "distance": 25}` (mm, signed) queues one move of
  the belt (`x`) or the lift (`y`) → `{"conveyor_id": 1, "axis": "x", "distance": 25, "run_id": 7, "instruction_count": 1}`.
  400 outside the permitted range: a belt keeps every cargo on it completely on the belt (an empty
  belt may turn one belt length); a lift stays within 0 … `length_y` and does not move while any
  cargo hangs over a belt's edge (409).
- `POST /cargo/{id}/position` with `{"on_conveyor_id": 4, "relative_x": 600}` overwrites where the
  cargo is; nothing moves. 400 over the edge of the belt, 409 closer than one cargo pitch
  (135 + 5 mm) to another cargo.
- `POST /cargo/{id}/navigate` with the same body lets the warehouse plan the way with its
  pathfinding (other cargo is moved aside) and queues it as one run →
  `{"cargo_id": 2, "on_conveyor_id": 4, "relative_x": 600, "run_id": 8, "instruction_count": 9}`.
  400 over the edge, 422 when no way is found.

The interface draws the permitted range with the same rules ([js/shared/limits.js](js/shared/limits.js)).

## Simulator only

`POST /sim/speed {"time_scale": 4}` and `POST /sim/reset` exist only in the simulator; the snapshot
then also carries `"simulated": true` and `"time_scale"`. The real warehouse does not need them.

## Open questions the interface had to guess

- `container.relative_center_x / z`: measured from the cargo's left edge and its wall-side edge.
- `cargo.relative_x`: the cargo's left edge (as the navigation code uses it).
- Cargo is drawn 135 mm wide (`CARGO_WIDTH`) and 90 mm deep; belts are drawn 96 mm deep, 34 mm in
  front of the board. Neither depth is in the database yet; they are constants in
  [js/world/themes.js](js/world/themes.js) and can be corrected per element with prefab offsets.
- Pipetter: `y_motor` value 0 is the top position and counts downwards, `z_motor` value equals the
  `relative_center_z` it stands over.
