# Wall Ball

maker: C · with: — · parent: — · session: —

## Pitch

Keep the ball bouncing! It flies off the walls, and you swat it back with your paddle. Every swat is a point.

## Rules

- R1 (auto): Holding up or down moves the paddle 3 pixels per frame. It stops at the top and bottom edges.
- R2 (auto): The ball bounces off the top, bottom and right walls and never goes past them.
- R3 (auto): When the ball hits the paddle it bounces back to the right, the score goes up by 1, and a
  sound plays.
- R4 (auto): When the ball gets past the paddle you lose a life, and a new ball comes from the middle
  within 60 frames.
- R5 (auto): At 0 lives the game-over screen shows within 30 frames.
- R6 (auto): The best score is still there after the game restarts.
- R7 (you check): The ball is easy to see and follow.

## Controls

- Player 1: stick up and down moves the paddle.
- START or A: start from the title screen, and go back to it after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Navy court, white walls, a gold paddle, a round white ball, hearts for lives. A "blip" and a "+1" on each swat; a "lose" and "MISS" when the ball gets past; a game-over panel.

## Assumptions

- A1: Three lives, because the request didn't say.
- A2: The ball starts at 1.5 pixels per frame across and speeds up by 0.25 per swat, up to 4.
- A3: Where the ball hits the paddle tilts its bounce, so you can aim a little.

## Changelog

- v1: First version, a template.
