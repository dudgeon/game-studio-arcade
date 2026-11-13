# Candy Cat Drop

maker: tester · with: — · parent: — · session: —

## Pitch

A cute falling-blocks puzzle. The blocks are candy, full lines go POP with sparkles, and a little cat at the bottom dances when you clear lines and gets sad when your stack gets too high. It speeds up gently. One or two players take turns.

## Rules

- R1 (auto): Pressing left or right moves the falling piece one cell that way. Holding repeats: after 12 frames, then every 4 frames. It stops at the walls and at blocks.
- R2 (auto): Pressing A turns the falling piece clockwise. Pressing B turns it counter-clockwise. A turn that would hit a wall or block is nudged aside if it can, otherwise it doesn't happen.
- R3 (auto): Holding down makes the piece fall one row every 3 frames.
- R4 (auto): Pressing up drops the piece straight down to where it lands, and it locks in that same frame.
- R5 (auto): On level 1 the piece falls one row every 48 frames by itself. When it can't fall any more, it locks in place and the next piece appears at the top.
- R6 (auto): Pieces come out of a "bag": each run of 7 pieces (1st to 7th, 8th to 14th, and so on) has all 7 kinds exactly once. The next piece is shown on the side.
- R7 (auto): When a row has no gaps, it is cleared: the rows above drop down by one, and the LINES count goes up by 1 for each row cleared.
- R8 (auto): Clearing rows scores 100 for 1, 300 for 2, 500 for 3 and 800 for 4 at once, times the level.
- R9 (auto): The level is 1 plus the LINES cleared divided by 5 (rounded down). Each level makes the piece fall 4 frames sooner than the one before, but never faster than one row every 12 frames.
- R10 (auto): When rows are cleared, at least 20 sparkles burst from them and last about 40 frames, and a "POP!" shows.
- R11 (auto): For 90 frames after rows are cleared, the cat is happy and dances.
- R12 (auto): When the stack is 12 rows tall or more (a block in the top 6 rows of the 18-row board), the cat is sad. If he is also happy from a clear, happy wins. Otherwise he is calm.
- R13 (auto): When a new piece has no room to appear, the round ends. With one player the game-over screen shows right away.
- R14 (auto): On the title screen, up or down picks 1 PLAYER or 2 PLAYERS. With 2 players, each plays one whole game in turn; between them a "pass the controls" screen shows until the next player presses A or START.
- R15 (auto): After the second player's game, the game-over screen shows both scores and who won (or a tie).
- R16 (auto): The best score is saved, and the title screen shows it after a restart.
- R17 (you check): Each kind of block looks like a different shiny candy.
- R18 (you check): The cat's happy face and sad face are easy to tell apart from each other.

## Controls

- Left / right: slide the piece. Down: fall faster. Up: drop it all the way.
- A: turn clockwise. B: turn the other way.
- Title: up / down picks 1 or 2 players. START or A starts. After game over, START or A goes back to the title.
- ★ is the cabinet's button; games never use it.

## Look & sound

Soft pastel night-sky background. Candy blocks: round, shiny, each kind its own color and pattern (stripes, dots, swirls). Rows burst into sparkles with a "pop" sound. The cat sits at the bottom, under the board: calm normally, bouncing with a big smile and star eyes when happy, drooping ears and a tear when sad. Left side shows score, lines and level; right side shows the next piece.

## Assumptions

- A1: This is our own game inspired by falling-block puzzles; it has its own name, candy look and cat.
- A2: "Not on my side" means two players take turns on one controller, not side by side. Each player gets one whole game, and the higher score wins (answered by the player).
- A3: The cat dances after clearing any line (the player said "every time you clear a line"), for 90 frames.
- A4: Gentle speed (player said "not super hard right away"): start at one row per 48 frames, +1 level every 5 lines, 4 frames faster per level, floor of 12 frames per row (reached at level 10).
- A5: Board is 10 wide and 18 tall. "Too high" for the cat means 12 rows tall (a block in the top 6 rows).
- A6: Pieces are the 7 classic four-block shapes, in the 7-bag order. A piece locks the moment it can't fall; there's no lock delay.
- A7: Dropping with up gives no extra points. Soft drop gives no extra points.
- A8: In two-player mode the best score saved is the higher of the two scores.
- A9: The player didn't pick a game-over rule; the round ends when the stack reaches the top (R13).
- A10: Cleared rows disappear right away; the pop and sparkles play in the same place at once, and the game keeps going without pausing.
- A11: R8 uses the level you had just before the rows were cleared (so a clear that brings you up a level still scores at the old level).

## Changelog

- v1: First version, built from the blank start.
