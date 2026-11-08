# Penguin Catch

maker: A · with: — · parent: — · session: —

## Pitch

You are a slippery penguin on the ice. Fish fall from the sky, so slide under them and catch them. Don't catch the boots. Miss three things and it's over.

## Rules

- R1 (auto): Holding left or right makes the penguin speed up by 0.25 pixels per frame, up to 3.5 pixels per frame. When you let go it keeps sliding and slows down by 4% each frame, so it does not stop at once. It stops at the left and right edges of the screen.
- R2 (auto): When the penguin touches a fish, the fish disappears that frame and the score goes up by 10.
- R3 (auto): You start with 3 lives. When a fish reaches the ice without being caught, the fish disappears and you lose one life.
- R4 (auto): When the penguin touches a boot, the boot disappears that frame, you lose one life, and the score does not change.
- R5 (auto): A boot that reaches the ice without being caught just disappears. You lose nothing.
- R6 (auto): When you have 0 lives left, the game-over screen shows within 30 frames and nothing more falls.
- R7 (auto): Things fall 1 pixel per frame at the start, and 0.2 pixels per frame faster every 600 frames of play, up to 3 pixels per frame.
- R8 (auto): The first 3 things that fall are always fish. After that, each new thing is a boot 15% of the time. That goes up by 5 percentage points every 600 frames of play, up to 40%. Boots really do fall during a game.
- R9 (auto): A new thing starts falling every 70 frames at the start. It gets 5 frames quicker every 600 frames of play, down to every 30 frames.
- R10 (auto): Pressing START on the title screen starts a game with score 0 and 3 lives. Pressing START on the game-over screen goes back to the title screen.
- R11 (auto): Your best score is saved. After a game ends and the game restarts, the title screen shows the best score.
- R12 (you check): The penguin looks like a penguin, and sliding on the ice feels slippery and fun.
- R13 (you check): A boot looks clearly different from a fish, so you can tell them apart while they fall.
- R14 (you check): The penguin does a happy hop and a "coin" sound when it catches a fish, and an "ouch" flash and a hit sound when it catches a boot.

## Controls

- Player 1: stick left and right slides the penguin.
- START or A: start from the title screen, and go back to the title after game over.
- ★ is the cabinet's button; games never use it.

## Look & sound

Dark blue polar night sky with twinkling stars and falling snow dots. A white and ice-blue ice floor along the bottom. A chubby black and white penguin with an orange beak and feet. Fish are orange and silver with a tail. Boots are brown and floppy, with a stinky green cloud. Lives are shown as little fish at the top; score and best at the top too. Sounds: "coin" for a fish, "hit" for a boot, "pop" for a missed fish, "lose" at game over.

## Assumptions

- A1: The player said "slides left and right but really slippery like on ice", so the penguin slides with speed-up and slow-down, not 5 hop spots.
- A2: Boots cost a life, the same lives as missed fish. There are 3 lives in total, shared by both kinds of mistakes (the player chose "lose a life", and the request said three misses).
- A3: The player chose "faster and more boots" for getting harder, so speed, boot chance and how often things fall all ramp up over time. The numbers are my choice.
- A4: A fish is worth 10 points. The request didn't say.
- A5: The first 3 things are always fish so the start is gentle. Missing a boot is fine, because the request says not to catch it.
- A6: Things start falling from just under the score bar, at a random left-right spot.
- A7: This is my own game, only inspired by classic catch games, with its own name and look.

## Changelog

- v1: First version, from A's request.
