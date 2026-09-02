# RoboTank

Stair-climbing tracked IoT rover, revision 2.2 (Δ10 700 mm track).
This repository holds the interactive 3D model with rigid-body physics, plus the drawing set and operating description it is built from.

## Run

Requires Node 20 or newer and pnpm.

```sh
pnpm install
pnpm dev        # Vite dev server
pnpm build      # typecheck, then production build into dist/
pnpm sim        # headless climb test for both track lengths, no browser needed
```

## What is in the app

- **3D model** built parametrically from the dimensions on sheet RT-100-01, so a change to `src/config.ts` changes the model.
- **Climb animation driven by physics** using cannon-es: a chassis with the drawing's mass and centre of gravity, eleven driven road wheels per side on hinge constraints, friction 1.0, motor torque 1.0 N·m per side. The simulation runs at a fixed 240 Hz and the renderer interpolates between steps, so the motion is smooth at any frame rate. The camera follows the rover with damping and never changes the angle you set.
- **One control panel**: Play, Pause, Reset, and Auto. With Auto on the rover holds forward and stops on the landing or reports a tip-over. With Auto off, W/S/A/D drive and Space brakes.
- **Track presets** for Rev 2.1 (450 mm) and Rev 2.2 Δ10 (700 mm), plus a Custom option.
- **Payload box** on the lid, a cube with editable size, weight and fore-aft position. Its weight adds to the total mass and moves the combined centre of gravity in the physics, so you can see what a load on top does to the climb.
- **Editable dimensions**: stair riser, tread, step count and width; rover wheelbase, sprocket and idler diameters, idler raise, track width, bay width, height, mass and centre of gravity. Any change rebuilds the model, the stair and the physics, so you can test a design against a stair before drawing it. The panel also reports the stair pitch, nosing pitch and floor-to-second-nosing distance, the number the wheelbase has to beat.

URL hashes: `#stair` places the rover on the stair, `#climb` starts the climb. Add `-long` (`#long`, `#stair-long`, `#climb-long`) to use the Δ10 track.

## Physics finding

The Rev 2.1 chassis cannot climb the first 180 mm riser from the floor.
With the rear on the floor and the nosing sliding along the belt, the centre of gravity never passes over the step edge, so the rover pitches to vertical and falls onto its back.
Friction, torque and approach speed do not change this.
The 700 mm track (Δ10, adopted in Rev 2.2) reaches the second nosing as the rear lifts and climbs the whole flight.
`pnpm sim` reproduces both results.

The model treats each track as a chain of wheels, so lug hooking on a nosing edge is not represented.
Treat the result as a conservative test of the geometry.

## Layout

```
src/config.ts    dimensions, stair, drivetrain constants
src/firmware.ts  stair state machine and speed caps
src/track.ts     belt loop, lugs, sprocket and idler
src/rover.ts     chassis, deck, electronics, sensors
src/scene.ts     renderer, camera, lights, ground, stair
src/physics.ts   cannon-es rigid-body model
src/hud.ts       DOM bindings
src/main.ts      wiring and frame loop
scripts/sim.ts   headless climb test
docs/            Rev 2.2 drawing set and PDF, operating description, parts and costing, stills
```
