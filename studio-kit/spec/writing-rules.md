# Writing checkable rules

A cart's `spec.md` is the source of truth (start from [template.md](template.md)). Its **Rules** are what the kid asked for, written so someone can check each one. There are two kinds:

- `(auto)`: the playtest proves it by pressing buttons, stepping frames and reading the game's state. Every auto rule needs a check in `checks.js` ([checks-format.md](checks-format.md)).
- `(you check)`: a person judges it on first play, answering yes or no on the cabinet. Use this for looks, feelings and fun.

Write rules before code, and change the spec first when the game changes.

## The form

```md
- R1 (auto): Holding right moves the frog 2 pixels per frame; it stops at the right edge.
- R2 (you check): The frog looks happy when it catches a fly.
```

- One rule per list item. Longer rules continue on lines indented by two spaces.
- Ids never change and are never reused. To drop a rule, delete its line and say why in the Changelog; its number stays unused. New rules take the next number after the highest one ever used (a fork continues from its parent's).
- Nothing but rules goes in the Rules section. Notes go in Assumptions.

## What makes an auto rule checkable

A good auto rule names **what happens**, **when** (in frames; the game runs at 60 per second), and **what you can see in the game's state** afterwards. If you can't picture the check, it isn't an auto rule yet.

| Bad | Why | Good |
|---|---|---|
| The controls feel responsive. | A feeling. | (auto) Pressing left moves the paddle 3 pixels left on the next frame. |
| You can catch the fruit. | When? What then? | (auto) When the basket touches a fruit, the fruit disappears that frame and the score goes up by 10. |
| It gets harder over time. | How much, when? | (auto) The rocks fall 1 pixel per frame faster every 600 frames, up to 6 pixels per frame. |
| It's not too hard at the start. | Untestable as written. | (auto) For the first 300 frames no rock falls faster than 2 pixels per frame. |
| The game ends when you lose. | Lose how? | (auto) When the ball goes past the paddle with 0 lives left, the game-over screen shows within 30 frames. |
| Two players can play. | Says nothing about how. | (auto) Player 2's stick moves only the right paddle; player 1's moves only the left. |
| There are sparkles when you score. | Checkable, but only by eye. | (you check) Sparkles burst from the goal when you score. |
| The frog looks cute. | Fine as a you-check rule. | (you check) The frog looks cute. |
| The high score is saved. | Saved where, seen when? | (auto) After a game over and a restart, the title screen shows the best score so far. |

## Tips

- **Split rules that do two things.** "Catching a fly scores 100 and plays a pop" is an auto rule and a you-check rule.
- **Prefer state over pixels.** "The score is 100" is easier to check, and less brittle, than "the digits 1 0 0 appear at the top". Check pixels only when what's on screen is the rule (e.g. "the game-over screen shows").
- **Use exact numbers.** If the kid didn't say, pick one, write it in the rule, and add an Assumption saying you chose it.
- **Say what the kid would notice.** Rules are read aloud on the "Here's the plan" screen, so keep them short and plain.
- **No randomness in the claim.** "A fruit falls about every 2 seconds" can't fail. "A new fruit appears at most 150 frames after the last one was caught or missed" can. The runtime's random numbers are seeded, so checks are repeatable.
- **Don't write rules about the code.** "Uses a grid array" isn't something the kid asked for.
