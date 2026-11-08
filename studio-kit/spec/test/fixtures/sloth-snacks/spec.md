# Sloth Snacks

maker: O · with: A · parent: — · session: sesn_fixture01

## Pitch

You're a sloth hanging from a vine. Catch the falling fruit, dodge the falling acorns.

## Rules

- R1 (auto): Holding left or right moves the sloth 1 pixel per frame, and it stops at the edges of the screen.
- R2 (auto): Catching a fruit adds 10 to the score.
- R3 (auto): Touching an acorn takes away one life. At 0 lives the game-over screen shows
  within 30 frames.
- R5 (auto): The high score is still there after the game restarts.
- R6 (you check): The sloth looks happy for a moment after each catch.

## Controls

- Player 1: stick moves left and right; A grabs faster for one second.
- START: pause, and start from the title screen.
- ★ is the cabinet's button; games never use it.

## Look & sound

Jungle greens and a dark-brown vine. A soft "bloop" for each catch, a thud for an acorn.

## Assumptions

- A1: Three lives, because the request didn't say.
- A2: Acorns get 10% faster every 30 seconds.

## Changelog

- v1: First version, from O's request.
- v2: Removed R4 (a bonus banana) because it made the game too easy; added R5.
