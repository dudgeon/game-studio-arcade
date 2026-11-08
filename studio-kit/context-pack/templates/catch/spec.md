# Apple Catch

maker: C · with: — · parent: — · session: —

## Pitch

Apples fall from the tree: slide your basket to catch them. Miss three and you lose. Watch out for rocks!

## Rules

- R1 (auto): Holding left or right moves the basket 3 pixels per frame. It stops at the edges of the screen.
- R2 (auto): A new thing starts falling every 50 frames of play, from a random spot at the top. It is an apple or a rock.
- R3 (auto): When the basket touches an apple, the apple disappears and the score goes up by 10.
- R4 (auto): When an apple reaches the ground, it disappears and you lose one life.
- R5 (auto): When the basket touches a rock, the rock disappears and you lose one life. The score doesn't change.
- R6 (auto): When a rock reaches the ground, it disappears and nothing else changes.
- R7 (auto): You start with 3 lives. At 0 lives the game-over screen shows within 30 frames.
- R8 (auto): Things fall 1 pixel per frame at first, and 0.25 faster every 600 frames of play, up to 2.5.
- R9 (auto): Every 5th thing to fall is a rock. The rest are apples.
- R10 (auto): The best score is still there after the game restarts.
- R11 (you check): It's easy to tell an apple from a rock at a glance.

## Controls

- Player 1: stick left and right moves the basket.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Blue sky, green ground, a brown basket, red apples and gray rocks. A "coin" for an apple, a "hit" for a rock, a "pop" for a miss, a "lose" at game over.

## Assumptions

- A1: Three lives, because the request didn't say.
- A2: Rocks come in a fixed pattern rather than by luck, so the playtest can prove it. Where things fall from is random.

## Changelog

- v1: First version, a template.
