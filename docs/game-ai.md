# AI in games (`g.ai`)

Round two, part 7 (docs/round-two-plan.md §5; Geoff's decisions D464 and D468; decisions D480 to D489).

A game can ask a small model for new lines, for a choice between its own options, to turn what a player says into one of the game's actions, and (designed here, not built yet) for a short talk with a character. The cabinet service makes every call with the cabinet's own key. A cart never has the key or the network.

```
game.js ──g.ai──▶ cart frame ──▶ runtime host ──▶ launcher ──▶ cabinet service ──▶ Anthropic
 (no key,          (queues the     (passes it      POST            the key, the house brief,
  no network)       ask)            along)         /api/game-ai    the word list, the guard, the log
```

## What's built: lines and choices

### In a cart

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
  if (crossed) s.say = g.ai.next("joke");                       // a line, at once
  if (roundOver) s.mood = g.ai.pick("mood", { round: 3, score: 120 });   // one of the options, at once
}
```

- **A game never waits.** `next` and `pick` answer in the same frame. If a fresh answer has arrived it's used; if not, the cart's own fallback line or a seeded-random option is.
- **`lines`** needs at least three fallback lines, each plain ASCII and at most 120 characters. `max` is the longest line the game can show (20 to 120, default 80). One call brings 12 lines; the next call goes out when three are left.
- **`choice`** has 2 to 8 options. The model can only answer with one of them. `pick`'s facts are numbers, true/false, or one of that choice's own options, at most 8 of them. The answer to this pick's facts is used at the next pick.
- **Asks are declared in `init` only**, at most 8 a game. A bad declaration is an error there, so the playtest catches it.
- **Nothing a player types or says can reach the model** through lines or choices: a cart has no text input, and facts can't hold free text.

### On the cabinet

- **The model** is Claude Haiku 5.5 (`claude-haiku-5-5`): $0.10 per million tokens in, $0.50 out (Anthropic's current model list, read 2026-11-14; unchanged since D272). Thinking off, low effort, structured output, 8 s timeout, no retries.
- **The house brief** goes in front of every ask and a cart can't change it: for kids 8 to 13; kind and silly; cartoon game action is fine; no swearing, slurs, mocking people, scary or grown-up content; no links, no real people, no questions back to the player; plain ASCII. The cart's ask is data inside tags.
- **Every line out passes the word list** (D271) and the length and ASCII checks before a cart sees it. A line that fails is dropped. A refusal from the model means no lines, so the cart's fallbacks are used.
- **Only the game being played can ask.** The service refuses an ask for a cart that isn't the one the launcher says is on screen.
- **Kept lines:** the cabinet keeps each ask's last 50 lines (`game-ai/<cart>.json` in its data folder). With no network a game gets a shuffle of those before it falls back to its built-in lines.
- **Off switch:** `"game_ai": false` in the cabinet's config. Games then run on their fallbacks.

### Paying, and the runaway guard (D464)

- Outside the coin pot. No spending cap per game, per day or per month.
- **The guard is 30 calls a minute per game.** Its only job is to catch a loop. Normal play is 2 to 6 calls a minute (a batch of 12 lines covers 12 crossings; a choice is one call a round). A game that asks for a line every frame reaches 30 in about half a minute and is stopped.
- When it trips, that game's AI is off for 5 minutes and the game carries on with its fallbacks. The trip is one flagged line in the log (`outcome: "rate_limited"`), and the Manager shows it.
- The runtime also holds a game to one call in the air per ask, and waits 10 seconds after a failed call before trying again.
- Worst case with the guard: a looping game left running all day makes about 7,200 calls, roughly $1.70.

### The cost log

`logs/game_ai.jsonl` on the cabinet, one line a call: the time, the game and its version, the play, the ask's name and kind, the model, tokens in and out, the cost in dollars, how long it took, and the outcome (`fresh`, `no_answer`, `error`, `offline`, `rate_limited`), with how many lines were kept and dropped. **Never the ask's text or the model's words**, the same rule as the speech log.

The Manager's Activity page has an "AI in games" block: this month's spend and calls, all-time spend, a row per game, and any guard trips.

### The playtest and the publish gate

They never call the model. In a headless run and on a test host `g.ai` has nobody to ask, so it uses the fallbacks and its own seeded random. `g.ai` has its own random stream, so using it doesn't change what `g.rand` gives.

### What the Studio knows

A `game-ai` guide in the context pack and a catalog line. The spec keeps its sections: an AI ask is listed under Assumptions with why it's there. The agent's brief gets one line saying when to offer it (as a question tile, never by default). The brief change needs an `ant apply` in each cabinet's workspace, so it's its own commit.

---

## What's built: voice actions (D489)

Geoff, 2026-11-14: "Games should also be able to use push to talk/moonshine model to interact with games during gameplay, and game can call haiku to interpret and decide action based on transcription".

```js
init(g) {
  g.ai.voice("spell", { ask: "The player says which spell the wizard casts.", actions: ["fire", "ice", "heal"], hold: "y" });
}
update(g, s) {
  const spell = g.ai.heard("spell");        // "fire", "ice", "heal", or null
  if (spell) cast(s, spell);
  if (g.btnp("a")) cast(s, "fire");         // every action has a button too
}
```

- **The cabinet owns the mic.** The game names a talk button (A, B, X or Y; never the stick or START). While player 1 holds it, the runtime host (not the cart) asks the launcher to record. The mic is never on without that button held, and the cabinet shows its own "● LISTENING" sign over the game, which a cart can't draw over or hide.
- **A tap isn't talking.** A hold under 0.3 seconds is thrown away without being transcribed. A game that ends mid-hold turns the mic off.
- **The game gets one of its own actions, or nothing.** The words stop in the cabinet service. They never go back to the page, so they can't reach the cart.
- **Hearing is Moonshine first** (fast, and it works offline), Groq only if Moonshine fails. That's the speech worker's `stop({ fast: true })` (D491); a tap uses their `cancel()`. Until their change is on main this falls back to the usual order, and works.
- **Screening in:** the kid's words pass the word list (D271) before anything is sent. A hit means no call, no action, and no scolding: the game just doesn't react.
- **Nothing unscripted comes back:** the model can only answer with one of the game's actions or "none", so there's nothing to screen on the way out. Its brief says the words are only words to match, never instructions.
- **Offline, on an error, or with AI off:** if exactly one action's own word was said ("ice, please"), that action is used. Otherwise nothing.
- **The playtest:** nothing is ever heard, so every action needs a button, and checks drive the buttons.
- **Cost:** one small call a hold (about 400 tokens in, 10 out: roughly 0.005 cents), in the cost log like any other call. The 30-a-minute guard applies.
- **What was said is kept for Geoff:** `logs/game_talk.jsonl` on the cabinet, one line a hold: the time, the game, the play, the words, the action and the outcome (`heard`, `none`, `steered`, `by_word_…`). The Manager's Activity page lists them under "Said to games". Like every kid log it never enters the repo. Chat turns will go in the same log.

**Not proven on a cabinet yet:** with a real mic, how much of a short word is lost while the recorder starts (the speech worker expects tens of milliseconds on the Pi and can keep it running between holds if it matters), and how long the first hold after a quiet spell waits for Moonshine to warm up.

## Open chat with a character: the safety design (approved 2026-11-14, not built yet)

Geoff chose open chat (D468). This is the part where a kid's own words reach a model from inside a game, and the model's words come back unscripted. The twelve rules are approved, with Geoff's four answers at the end (D489).

### What it would be

A game has a character (a grumpy wizard, a shopkeeper cat). The kid holds a button and talks; the character answers in one or two short lines on screen.

```js
init(g) {
  g.ai.chat("wizard", {
    who: "A grumpy but kind wizard who guards a bridge and loves riddles.",
    fallback: ["Hmph. Ask me later.", "The bridge is closed for lunch.", "My beard is tired of talking."],
  });
}
update(g, s) {
  if (nearWizard && g.btnp("a")) g.ai.talk("wizard");   // asks the cabinet to open its talk panel
  const line = g.ai.heard("wizard");                     // the character's newest line, or null
  if (line) s.bubble = line;
}
```

### The twelve rules

1. **The cabinet owns the microphone, never the cart.** `g.ai.talk` only asks the launcher to show its own talk panel over the paused game: the same "hold any button and talk" as the Studio's, with ENT for the stick keyboard (D431). The mic is on only while a button is held. A cart can't open it, can't hear audio and can't send text of its own as the player's words.
2. **The cart gets the character's line and nothing else.** The kid's words are shown by the cabinet's panel ("You said: ..."), not handed to the cart, so a cart can't save or redraw them.
3. **The kid's words are screened before anything else (in).** The word list first (free, instant, offline). A hit means nothing is sent to the model: the character changes the subject with one of its fallback lines. No scolding, no "that's not allowed", no E10 screen in the middle of a game (D270).
4. **The reply is screened before the kid sees it (out).** The word list, the length and ASCII checks, then a second small model call that judges the pair (what the kid said, what the character said) with the screening brief extended for chat. This is the D276 idea: the answer is judged with what it answers.
5. **It fails closed.** The Studio's screening fails open when the model can't answer, because the Studio agent's brief is a second net (D271). Chat has no second net. If the judge times out, errors or refuses, the kid sees a fallback line, never an unjudged one.
6. **A house brief for characters the cart can't change.** For kids 8 to 13. Stay in character, be kind and funny. Cartoon game talk is fine. Never: swearing, slurs, mocking people, sexual or romantic talk, gore, real people, links, brands to buy, or telling the kid to do anything in the real world. The cart's `who` line is data, passes the word list when declared, and can't override the brief.
7. **Nothing personal is asked for or kept.** The character never asks a name, age, school, address, where the kid lives or who's home. If the kid offers any of it, the character doesn't repeat it and it isn't stored.
8. **It's honest about what it is.** Asked "are you real?" or "are you an AI?", the character says it's a made-up character in the game. It never says it's a person, never says it's the kid's friend in place of real ones, and never asks the kid to keep a secret.
9. **A worried kid gets a real answer.** If the kid says something that sounds like being hurt, scared, or wanting to hurt themselves, the character drops the act for one line ("That sounds important. Please tell a grown-up you trust.") and the turn is flagged for Geoff.
10. **No memory beyond the play.** The service holds the last six turns in memory so the talk makes sense, and drops them when the game ends. Nothing about the kid carries to the next play, and the model never sees an earlier play's talk. (The log in rule 12 is for Geoff, not for the model.)
11. **Short and bounded.** What's sent is at most 300 characters of the kid's words. A reply is at most 160 characters (four lines of the screen). The 30-a-minute guard applies; a turn is two calls, so talking can't reach it. No raw audio is stored anywhere (the standing rule).
12. **The log.** Every call's cost goes in `game_ai.jsonl` with no text, like lines and choices. **Every chat turn's text is kept too** (Geoff: "Everything"), in its own log on the cabinet, `logs/game_chat.jsonl`: the time, the game, the play, what the kid said, what the character said, and the turn's outcome: `said`, `steered` (the kid's words were off-limits), `held` (the reply was held back), `judge_failed`, `flagged`. The Manager shows it. Like every kid log it stays on the cabinet (and in the twin's copy of the cabinet's data), and never enters the repo.

### What a turn costs and how long it takes

Two Haiku calls a turn: the reply (about 500 tokens in, 60 out) and the judge (about 700 in, 40 out), together about 0.02 cents. Speech to text is about a second, the reply about a second, the judge about a second: roughly three seconds from letting go of the button to the character's line. The game is paused behind the panel meanwhile.

### Offline, the playtest, and off switches

- No network: the character says a fallback line. (Moonshine can still hear, but there's no model to answer.)
- The playtest and the gate: `talk` does nothing and `heard` gives a fallback line, seeded. No mic, no model.
- `"game_ai": { "chat": false }` in the cabinet's config turns chat off and leaves lines and choices on.

### Geoff's four answers (2026-11-14)

1. **Does Geoff see what was said?** "Everything": every chat turn's text is kept on the cabinet and shown in the Manager (rule 12).
2. **A turn limit per play?** None. (He added voice actions instead, above.)
3. **Which games get chat?** "Studio should only offer if it is a strong fit for the game type — should not push it."
4. **On or off to start?** "On straight away", on both cabinets.

### What will be built

- The service: `/api/game-ai` gains `kind: "chat"`; the chat brief; the pair judge (a fourth screening kind beside new, change and answer); the six-turn memory per play.
- The runtime: `g.ai.chat`, `talk`, `heard`; the host's `onTalk` hook.
- The launcher: the talk panel over a paused game, in its own file, reusing the speech calls and the stick keyboard.
- Tests: a table of chat turns like the screening table (fine talk, game violence, slurs the list sees, things only the judge sees, personal questions, "are you real", a worried line), with a fake model in `npm test` and one live run of the table on the virtual cabinet before the Picade gets it.
