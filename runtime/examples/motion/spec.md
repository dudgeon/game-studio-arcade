# Motion Showcase

maker: C · with: — · parent: — · session: —

## Pitch

Four short scenes that show how things can move: run and jump through a scrolling world, drive round a ring road, walk a maze from the inside, and watch chunky cars circle a tower.

## Rules

- R1 (auto): START goes to the next scene: RUN, DRIVE, MAZE, SPIN, then RUN again.
- R2 (auto): With nothing pressed for 150 frames, the next scene starts by itself.
- R3 (auto): In RUN, holding right speeds the runner up by 0.2 pixels per frame each frame, up to 2.2.
  Letting go slows it by 0.2 each frame to a stop.
- R4 (auto): In RUN, the screen follows the runner through a world 640 pixels wide: the runner is
  always on screen, and the screen never shows past either end of the world.
- R5 (auto): In RUN, A jumps: the runner leaves the ground, comes back down and lands on it.
- R6 (auto): In DRIVE, holding left turns the view further left than it turns by itself.
- R7 (auto): In MAZE, holding up walks forward, and walls stop the walker: it is never inside a wall.
- R8 (auto): In SPIN, the cars keep circling, and holding right makes them circle faster.
- R9 (you check): Scrolling and slow movement slide smoothly instead of stepping a whole pixel at a time.
- R10 (you check): It still looks like pixel art: chunky pixels, the 32 colors, nothing blurred.

## Controls

- Player 1: the stick moves, steers or turns; A jumps in RUN.
- START: the next scene.
- ★ is the cabinet's button; games never use it.

## Look & sound

RUN: a blue sky, far hills and nearer trees that slide at different speeds, a runner who squashes when he lands and kicks up dust, coins that turn and burst. DRIVE: a gray ring road on grass under a banded sky, trees that grow as they come near, far ground fading darker. MAZE: brick and blue-panel walls, darker with distance, and bobbing gems. SPIN: red cars built from slices circling an orange tower on a night sky. Each scene's name drops in with a bounce.

## Assumptions

- A1: No score and no game over: it's a showcase, not a game.

## Changelog

- v1: First version, for D475 to D479.
