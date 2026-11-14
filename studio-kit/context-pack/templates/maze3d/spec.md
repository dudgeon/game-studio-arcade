# Gem Maze

maker: C · with: — · parent: — · session: —

## Pitch

You are inside a brick maze. Find all five gems before the clock runs out.

## Rules

- R1 (auto): Holding left or right turns you. The turning builds up by 0.005 each frame to 0.045
  a frame, and eases off the same way when the stick is let go.
- R2 (auto): Holding up walks the way you face, and down walks backward. The speed builds up by
  0.006 tiles per frame each frame to 0.06, and eases off the same way.
- R3 (auto): Walls stop you. You are never inside a wall.
- R4 (auto): Coming within half a tile of a gem takes it and scores 10.
- R5 (auto): Taking all 5 gems wins, and the game-over screen shows within 30 frames.
- R6 (auto): A round lasts 3600 frames. Then the game-over screen shows within 30 frames.
- R7 (you check): Walls far away are darker than walls close by, and the gems bob up and down.

## Controls

- Player 1: stick left and right turns. Up walks forward, down walks back.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Red brick walls and blue panels seen from inside the maze, a dark blue ceiling and a green floor, all darker in the distance. Bright aqua gems that bob. "+10", a "coin" and a burst of sparks for a gem, a "win" for the last one, a "lose" when time runs out.

## Assumptions

- A1: Nothing chases you, because the request didn't say.
- A2: Sixty seconds a round, and the same maze every time, so the playtest can prove it.

## Changelog

- v1: First version, a template.
