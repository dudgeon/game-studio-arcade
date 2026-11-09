# Gem Maze

maker: C · with: — · parent: — · session: —

## Pitch

Walk through the hedges and grab as many gems as you can before time runs out.

## Rules

- R1 (auto): Tapping a direction moves you one tile that way. Holding it moves one more tile
  after 12 frames, then one every 6 frames. You can't leave the map.
- R2 (auto): You can't walk into a wall.
- R3 (auto): Stepping onto a gem adds 10 to the score, and a new gem appears on another floor tile, so
  there are always 3 gems.
- R4 (auto): A round lasts 30 seconds (1800 frames), then the game-over screen shows.
- R5 (auto): The best score is still there after the game restarts.
- R6 (you check): The gems twinkle.

## Controls

- Player 1: stick walks.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Dark green floor, teal hedges, a little walker, pink and aqua gems that twinkle. A "coin" and a "+10" for each gem; a "win" and a panel when time runs out.

## Assumptions

- A1: Tiles are 16 pixels, with the timer and score in a band at the top.
- A2: A countdown shows the seconds left, because a timed round needs one.

## Changelog

- v1: First version, a template.
