# spec.md

The spec is the source of truth. A template's `spec.md` shows the format; keep its headings, in order:

`# Title`, then `maker: A · with: — · parent: — · session: —`, then `## Pitch`, `## Rules`, `## Controls`, `## Look & sound`, `## Assumptions` (`- A1: …`), `## Changelog` (`- v1: …`).

Rules are one list item each (longer ones continue on lines indented two spaces), and nothing else goes in that section:

```md
- R1 (auto): Holding right moves the frog 2 pixels per frame; it stops at the right edge.
- R2 (you check): The frog looks happy when it catches a fly.
```

Ids never change and are never reused. `(auto)`: the playtest proves it by pressing buttons, stepping frames and reading state. `(you check)`: a person judges looks, feelings and fun.

**An auto rule names what happens, when (in frames, 60 per second), and what's visible in the game's state.**

| Bad | Good |
|---|---|
| You can catch the fruit. | When the basket touches a fruit, it disappears that frame and the score goes up by 10. |
| It gets harder over time. | The rocks fall 1 pixel per frame faster every 600 frames, up to 6. |
| The game ends when you lose. | At 0 lives the game-over screen shows within 30 frames. |
| A fruit falls about every 2 seconds. | A new fruit starts falling every 120 frames of play. |
| The high score is saved. | After a game over and a restart, the title shows the best score so far. |
| There are sparkles when you score. | (you check) Sparkles burst from the goal when you score. |

- Split a rule that does two things, like "scores 100 and plays a pop".
- Use exact numbers. If the kid didn't say, pick one, write it in the rule, and add an Assumption.
- Prefer patterns over luck when a rule is about how often: "every 5th thing is a rock" can be proved.
- Rules are read aloud on the plan screen, so keep them short and plain. None about the code.
