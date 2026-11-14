# Studio round two: decision walkthrough

A narrated page that takes Geoff through [the round two plan](../round-two-plan.md): three chapters of findings, eight decisions with a recommendation each, and a close. Made with the user-level `decision-walkthrough` skill (`~/.claude/skills/decision-walkthrough`; its SKILL.md has the steps).

| Stop | Proposed decision | The question |
| --- | --- | --- |
| `cap` | D450 | How long a kid can talk in one hold |
| `review` | D453 | How a long transcript is read back |
| `live` | D454 | Whether words appear while a kid is talking |
| `names` | D456 | How a maker picks a version's name |
| `motion` | D459 | How far motion and depth go |
| `ai-pay` | D464 | Who pays for AI in games, and the cap |
| `ai-scope` | D468 | What games may ask the model for first |
| `order` | D469 | The order of work |

- `spec.json`: the chapters, narration, cues and options.
- `scenes/` and `scenes.css`: one animated scene per chapter. The cabinet's screen is drawn in the launcher's palette; nothing in them is a kid's words.
- `page/`: the built page: `index.html`, `audio/*.mp3` and `publish.json`.
- `checks/`: the last headless check's report and screens.

Rebuild: `node ~/.claude/skills/decision-walkthrough/build.mjs docs/round-two-walkthrough/spec.json`. Only changed lines are voiced again, under the GPU lock. `.cache/` isn't committed.

Answers reach the director three ways: the page's db (`answers/<stop id>`), a comment sent to Claude per answer, and **Copy decisions for Claude**. Each answer then becomes a row in `docs/decisions.md` with the number above, Geoff's words if he added any, and "via the walkthrough".
