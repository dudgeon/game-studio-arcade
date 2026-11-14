# Star Run

maker: C · with: — · parent: — · session: —

## Pitch

Run and jump through a long world, grab the stars, hop the spikes and the pit, and reach the flag.

## Rules

- R1 (auto): Holding left or right speeds the runner up by 0.2 pixels per frame each frame, up to 2.
  Letting go slows it by 0.2 each frame to a stop.
- R2 (auto): A makes the runner jump when it is standing on something. It comes back down and lands.
- R3 (auto): Touching a star takes it and scores 10.
- R4 (auto): The screen follows the runner. The runner is always on screen, and the screen never
  shows past either end of the world.
- R5 (auto): Touching spikes or falling down the pit costs a life and puts the runner back at the start.
- R6 (auto): You start with 3 lives. At 0 lives the game-over screen shows within 30 frames.
- R7 (auto): Touching the flag scores 50 and wins: the game-over screen says so.
- R8 (you check): The far hills slide by slower than the ground, and the runner squashes when it lands.

## Controls

- Player 1: stick left and right runs. A jumps.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Blue sky, teal hills far away and darker bushes nearer, brown ground with grass on top. An orange runner in blue, yellow stars that bob, silver spikes, a red flag. A burst of sparks and a "coin" for a star, a shake and a "hit" for spikes.

## Assumptions

- A1: Three lives, because the request didn't say.
- A2: One level, the same every time, so the playtest can prove it.

## Changelog

- v1: First version, a template.
