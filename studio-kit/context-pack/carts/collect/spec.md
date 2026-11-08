# Gem Garden

maker: C · with: — · parent: — · session: —

## Pitch

Walk around the garden and grab as many gems as you can before time runs out.

## Rules

- R1 (auto): Tapping a direction moves the gardener one tile that way. Holding it moves one more tile
  after 12 frames, then one every 6 frames. The gardener can't leave the garden.
- R2 (auto): Stepping onto a gem adds 10 to the score, and a new gem appears on another tile, so there
  are always 3 gems.
- R3 (auto): A round lasts 30 seconds (1800 frames), then the game-over screen shows.
- R4 (auto): The best score is still there after the game restarts.
- R5 (you check): The gems twinkle.

## Controls

- Player 1: stick walks the gardener.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Green grass tiles, a peach gardener, pink and aqua gems that twinkle. A "coin" for each gem, a "win" when time runs out.

## Assumptions

- A1: Tiles are 16 pixels, with the timer and score in a band at the top.
- A2: A countdown shows the seconds left, because a timed round needs one.

## Changelog

- v1: First version, an example cart for the context pack.
