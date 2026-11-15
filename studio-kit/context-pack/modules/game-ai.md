# AI in a game: `g.ai`

A game can get made-up lines (a new joke each crossing), choices (how the boss acts next) and spoken commands from a small model while it's played. The cabinet makes the call; the game never waits and never needs the network.

**Use it only when it's a strong fit:** the player asked for something new each time (jokes, taunts, a character's mood) or to talk to the game. Don't add it to a game that doesn't need it, and don't push it. If it fits and they didn't ask, offer it once as a question tile ("Should the duck make up new jokes each time?"); never by default.

```js
init(g) {
  g.ai.lines("joke", {
    ask: "A short, silly duck joke for a kid.",
    fallback: ["Why did the duck cross the road? To prove he wasn't chicken!", "What time does a duck wake up? At the quack of dawn!", "What do ducks eat with soup? Quackers!"],
    max: 80,
  });
  g.ai.choice("mood", { ask: "The boss just lost a round. How does it act next?", options: ["sneaky", "angry", "scared"] });
  return { say: "", mood: "sneaky" };
},
update(g, s) {
  if (crossed) s.say = g.ai.next("joke");                              // a line, in this frame
  if (roundOver) s.mood = g.ai.pick("mood", { round: s.round, score: s.sc.score });   // one of the options, in this frame
}
```

**Rules**
- Declare every ask in `init`, once, at most 8. `name` is small letters, digits and `_`.
- `ask` is one plain sentence (ASCII, at most 300 characters) saying what one line is, or what to choose. Write it yourself; it never holds the player's words.
- `lines` needs `fallback`: at least 3 good lines of your own (5 or more is better). They are what a playtest sees, and what the game shows with no Wi-Fi. `max` is the longest line the game can show: 20 to 120, default 80. Every fallback fits in `max`.
- `g.ai.next(name)` always returns a line at once: a fresh one if the cabinet has some, else a fallback (all of them before any repeats). Call it when the line is needed, not every frame.
- `choice` has 2 to 8 `options`, plain words of at most 24 characters. `g.ai.pick(name, facts?)` returns one at once. `facts` are numbers, true/false, or one of the options, at most 8. The answer to these facts comes back for the next `pick`, so write the ask about "next".
- Write game code for the options, not for what a line says: a line is only text to show.
- `g.ai` has its own random stream; using it doesn't change `g.rand`.

**Talking to the game:** `g.ai.voice("spell", { ask: "The player says which spell to cast.", actions: ["fire", "ice", "heal"], hold: "y" })` in `init`. While the player holds that button (`a b x y`) the cabinet listens; `g.ai.heard("spell")` in `update` gives the action they meant, once, or `null`. The game never gets the words. Give every action a button too: in a playtest, and with no microphone, nothing is ever heard, so checks use the buttons. Say on screen which button to hold. One voice ask per button.

**Showing a line:** a screen line holds `g.W / 6` characters at scale 1. Wrap by words into rows, and give the line time to be read (about 3 seconds). Keep `max` to what your rows can hold.

**In checks:** a playtest only ever gets fallbacks and seeded picks, so checks repeat. Check that a line is shown and is one of the fallbacks, or that the mood is one of the options. Never check for a particular fresh line. Probe the line and the choice (`say`, `mood`).

**In the spec:** rules say what the player sees ("The duck says a joke each time it crosses"), with the fallbacks' flavour. List each ask under Assumptions with why it's there: "Jokes are made up fresh by AI when the cabinet is online; three are built in."

**Not for:** anything the game needs to be fair or winnable (level layouts, scores, timing), anything about real people, and anything the player types or says.
