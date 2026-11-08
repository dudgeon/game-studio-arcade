# Comet Dodge

maker: C · with: — · parent: — · session: —

## Pitch

You fly a little ship. Comets zoom in from the right. Don't get hit, and stay alive as long as you can.

## Rules

- R1 (auto): Holding a direction moves the ship 2 pixels per frame that way. It stops at the edges of the screen.
- R2 (auto): While playing, the score goes up by 1 every 60 frames.
- R3 (auto): Touching a comet takes away one life and removes that comet. For the next 90 frames
  comets can't hurt the ship.
- R4 (auto): At 0 lives the game-over screen shows within 30 frames.
- R5 (auto): Comets start at 1 pixel per frame and get 0.5 faster every 600 frames of play, up to 3.
- R6 (you check): The ship blinks while comets can't hurt it.

## Controls

- Player 1: stick moves the ship.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Dark night sky with drifting star dots. A sky-blue ship, orange comets. A "hit" sound when a comet gets you, a "lose" sound at game over.

## Assumptions

- A1: Three lives, because the request didn't say.
- A2: A new comet every 40 frames, at a random height.

## Changelog

- v1: First version, a template.
