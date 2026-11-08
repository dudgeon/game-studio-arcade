# Starter library reference

The house starter library: tested building blocks a cart reaches as `g.lib` (D50). One file per module, read only the ones a game needs (D160):

- [collide](ref/collide.md): overlap, and who destroys whom.
- [flow](ref/flow.md): title → play → game over.
- [grid](ref/grid.md): boards, tiles, pieces, rotation, full rows.
- [score](ref/score.md): points, lives, saved high score.
- [timers](ref/timers.md): frame counts, repeats.
- [turns](ref/turns.md): take turns, pass the controls.

Conventions that hold everywhere:
- **State is plain data you keep.** Helpers that remember something give you a JSON object to keep in `s`; the library holds nothing between calls. So `probe()` can return them as they are.
- **Time is frames,** 60 per second. Never wall time.
- **`g` comes first** when a helper needs input, the frame count or saves. The rest are pure.
- **Mutating helpers say so** in their entries. The others return new values.

**To add a module:** one `runtime/lib/<name>.js` exported from `index.js`, one `ref/<name>.md` with a `### \`name.fn(...)\`` entry per export, and one line in `studio-kit/context-pack/CATALOG.md`. Tests fail if any of those is missing.
