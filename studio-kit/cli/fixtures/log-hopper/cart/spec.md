# Log Hopper

maker: tester · with: — · parent: — · session: —

## Pitch

A little frog hops across a wide river by jumping from one floating log to the next. Fall in the water and you lose a life. You have three lives. Get to the other side to score, then go again, with the logs getting faster.

## Rules

- R1 (auto): Each press of the stick makes one hop of 16 pixels (one row up or down, or one step left or right). Holding the stick does not hop again.
- R2 (auto): There are 8 river lanes (rows 2-5 and 7-10, counting from the top at row 0). Each lane has 4 logs that float along and wrap around the screen, and neighbouring lanes float in opposite directions.
- R3 (auto): While the frog sits on a log it floats along with that log, moving the same number of pixels per frame as the log.
- R4 (auto): If the frog lands in the water, with the middle of the frog not over any log, it loses 1 life that same frame. 30 frames later the frog is back at the start (row 11, middle of the screen).
- R5 (auto): If a log carries the frog off the left or right edge of the screen, it loses 1 life, just like falling in the water.
- R6 (auto): The start row (11) and the middle row (6) are safe: the frog can stand there as long as it likes.
- R7 (auto): Reaching the top bank (row 1) scores 100 points, and the frog goes back to the start with no life lost.
- R8 (auto): After each crossing, every lane's logs go 0.1 pixels per frame faster, up to 0.5 faster than at the start.
- R9 (auto): The player starts with 3 lives. When the last life is lost, the game-over screen shows within 60 frames.
- R10 (auto): The best score is still there after the game restarts.
- R11 (you check): The frog, the logs and the water are easy to tell apart, and you can see the frog hop.
- R12 (you check): When the frog falls in, a splash shows where it fell.

## Controls

- Player 1: stick hops the frog (left, right, up, down). One press, one hop.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Blue river with ripples, green banks, a brown log with lighter ends, a green frog seen from above with big eyes. A small arc when the frog hops, a white splash ring when it falls in, "+100" pops up on a crossing. Sounds: jump when hopping, coin on a crossing, hit when the frog falls in, lose at game over.

## Assumptions

- A1: The frog hops one press at a time (the player picked this).
- A2: Only logs float in the river, no animals or other dangers (the player stopped the questions, so this stays simple).
- A3: The screen is 12 rows of 16 pixels: row 0 shows the score and lives, row 1 is the top bank, rows 2-5 river, row 6 a middle bank, rows 7-10 river, row 11 the start bank.
- A4: Lane speeds at the start, in pixels per frame, from row 10 up to row 2 (skipping the bank): 0.5, 0.7, 0.6, 0.8 for rows 10, 9, 8, 7 and 0.6, 0.9, 0.7, 1.0 for rows 5, 4, 3, 2. Row 10 floats right, row 9 left, and so on, switching each lane.
- A5: Log lengths in pixels, row 10 up to row 2: 64, 48, 48, 56 (rows 10, 9, 8, 7) and 48, 40, 48, 40 (rows 5, 4, 3, 2). The 4 logs in a lane sit 80 pixels apart, start by a random amount.
- A6: A frog is "on a log" when the middle of the frog, left to right, is inside the log.
- A7: There is no time limit; the frog can wait on a bank. Only the 3 lives end the game.
- A8: A hop that would leave the screen to the left or right is ignored; a hop down from the start row is ignored.
- A9: Inspired by classic river-crossing games, but with its own name, look and sounds.
- A10: R8: the speed-up counts crossings, and adds 0.1 pixels per frame for each one, up to 5 crossings.
- A11: R6: the top bank is not a place to stand; reaching it counts as a crossing and sends the frog back to the start at once (R7).

## Changelog

- v1: First version.
- v2: R6 no longer includes the top bank; reaching it is a crossing (R7), so the frog never stands there (A11).
