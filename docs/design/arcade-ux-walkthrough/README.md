# Arcade UX decision walkthrough

A narrated walkthrough of the arcade UX design (the Claude Design canvas https://claude.ai/artifact/M8ndK7LnLr1vYo266rovJA). It covers 5 findings and 5 decisions, about 4 minutes straight through, in Duo's house voice.

- Findings: what Geoff asked for, the kids' loop (shelf, make, play, check, change), what today's two live makes taught us, and two settled chapters (the family coin pot and changing games).
- Decisions: Q11 shelf versions (4 options), Q13 plan length (3), Q15 the real account limit vs overruns, Q16 when the pot is too low to start, and Q17 leftover coins on the 1st. Q15 to Q17 come out of Geoff's answers of 2026-11-10.

Files:
- `spec.json`: the chapters, narration, cues and decisions.
- `scenes/` and `scenes.css`: one animated scene per chapter, in the house runtime's palette (D180).
- `assets/`: the live plan screen from the virtual cabinet.
- `page/`: the built page, ready to publish (`publish.json` lists its files).
- `checks/`: the last headless check.

Rebuild with the user-level skill: `node ~/.claude/skills/decision-walkthrough/build.mjs spec.json`. Only changed lines are re-voiced, under the GPU lock. `.cache/` is not committed.

Answers come back three ways: in the page's db (`answers/<id>`), as a comment sent to Claude per answer, and through "Copy decisions for Claude".
