# Talking to a character: `g.ai.chat`

The player holds a button and talks to a character in the game; the character answers in one short line. The cabinet does the listening, the answering and the safety checks. The game only ever gets the character's line.

**Use it only when it's a strong fit:** the player asked for a character they can talk to, or the whole idea is a conversation (a riddling wizard, a shopkeeper who haggles). Don't add it to a game that doesn't need it, and don't push it. Read the `game-ai` guide first; the same house rules apply.

```js
init(g) {
  g.ai.chat("wizard", {
    who: "A grumpy but kind wizard who guards a bridge and loves riddles.",
    fallback: ["Hmph. Ask me later.", "The bridge is closed for lunch.", "My beard is tired of talking."],
    hold: "x",
    max: 80,
  });
  return { bubble: "", bubbleFor: 0 };
},
update(g, s) {
  const line = g.ai.reply("wizard");            // the wizard's newest line, once; else null
  if (line) { s.bubble = line; s.bubbleFor = 240; }
  if (s.bubbleFor > 0) s.bubbleFor--;
}
```

**Rules**
- Declare each character in `init`. `who` is one or two plain sentences about the character (ASCII, at most 300 characters): who they are, their mood, what they care about. Write it yourself; no real people, and nothing a kid shouldn't read.
- `hold` is the talk button: `a b x y`, one ask per button (a `voice` ask can't share it). Say on screen which button to hold: "HOLD X TO TALK".
- `fallback` is at least 3 lines the character says when it can't answer (no Wi-Fi, or the cabinet held a line back). Make them in character and fit any question. 5 or more is better.
- `max` is the longest line the game can show: 40 to 160, default 120. Every fallback fits in it.
- `g.ai.reply(name)` gives each line once, then `null`. Keep it in state and show it long enough to read (about 4 seconds), wrapped by words: a screen line holds `g.W / 6` characters.
- The game never gets what the player said, so don't write rules that depend on it. For "say the password" or "say a spell", use a `voice` ask with actions (the `game-ai` guide): that's what gives the game something to act on.
- The game keeps running while the player talks. If that would be unfair, make the spot near the character safe.

**In checks:** a playtest never hears anyone, so `reply` is always `null` there. Check the game without the talk: the character is drawn, the hint is shown, the game can be won. Use `poke` to put a line in the bubble if a rule is about showing it.

**In the spec:** a rule says the player can talk to the character and it answers ("Hold X and talk to the wizard; he answers in a speech bubble"), marked `(you check)`. List it under Assumptions: "The wizard's answers are made up by AI when the cabinet is online; three are built in."
