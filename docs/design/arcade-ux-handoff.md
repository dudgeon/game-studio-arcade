# Arcade UX: build handoff

What to build so the cabinet matches the settled design. Source of truth, in order: [decisions.md](../decisions.md) D201 to D207 (and the earlier D-numbers they cite), this file, then the canvas https://claude.ai/artifact/M8ndK7LnLr1vYo266rovJA (board ids below, such as `M3`). The walkthrough that settled the last five questions is https://claude.ai/artifact/VTPQrXr9TXRN92r1qRMjd7. The canvas is a mock-up at 2x in an approximation of the house font, so take layout and copy from it but fit it to the real console with `text.js` (D180, D181).

This file says what each screen shows and does, and the coin rules and their numbers. How to build it (state, storage, API shape, module split) is the coding worker's call, inside the existing service and launcher (`cabinet/service/src`, `cabinet/service/launcher/screens.js`).

## 1. Rules that apply everywhere

- The screen is 256 x 192 at 4x (D81, D180). Every string goes through `text.js`, with its fit rules and tests (D181). Copy on the canvas was written to about 40 columns; where it doesn't fit the real font, shorten it rather than shrink it.
- Controls: the stick chooses; any of the six player buttons (or START) picks what's lit (D182); ESC goes back (D88); F1 (the Picade's ENT) types on talk screens (D184): on a keyboard where there is one, else with the stick on the grid keyboard (D430, D431). **The one exception is the coin check (M3, R3): only COIN starts spending** (D205). COIN is the X HAT's F2 (D82). On the shelf, COIN opens the coin pot (A1).
- Kid-language only. No "cart", "kit", "session", "tokens" or "spec" on screen (D183, D190).
- Names, not initials (D87). Disclose AI on the first make screen ("Hi! I'm Claude, an AI.").
- Every error and edge screen says what happened, that the game or idea is kept, and what it cost. No "Oh no" over hopeful news.

## 2. The coin pot: rules and numbers

| Rule | Value | Decision |
|---|---|---|
| Coin value | 1 coin = 10 cents | D202 |
| Shown as | coins big, real cents small beside them (e.g. "6 coins (56c)") | D202 |
| The pot | one per cabinet, shared by every maker, friends included | D202 |
| Monthly budget | 100 coins = $10 | D202 |
| Refill | on the 1st (cabinet local time) the pot is set to 100; leftovers don't carry over; a negative balance is wiped | D202 |
| Charge | each make or change is charged its real cost: the session's list cost at the end, in cents | D202 |
| Rounding | the ledger keeps exact cents; screens show whole coins, rounded to nearest (56c shows as 6) | D202 |
| Refunds | none: failed, stopped, abandoned and restart-cut makes are all charged what they cost | D202 |
| Start gate | a make starts only if the pot (in coins) is at least the usual cost: **6** for a new game, **3** for a change | D203 |
| Usual costs | settings (`usual_cost_new` 6, `usual_cost_change` 2), not constants; the change's was a guess of 3 until the first live change measured 9c | D203, D214 |
| Overrun | a started make always finishes; the pot can go negative until the 1st | D203 |
| Per-make cap | the session budget stays about $3 (§3.2, D157); it isn't tied to the pot | D204 |
| Real limit | cabinet workspace spend limit $15 (Geoff sets it in the Console) | D204, D211 |
| Who adds coins | grown-ups only, in the Cabinet Manager, each with a reason the kids see | D205 |
| Spending starts | only with COIN on the coin check | D205 |

What counts as spent: everything the session costs, including questions asked before a kid walks away. A make stopped at a question costs what it used (often a coin or less).

**Per-maker totals:** for the current month, the coins and cents charged to each maker id (D87's `makers.json`, guests included). Show every maker with a charge this month, most first.

**The ledger** (the canvas's coin history, A2 and the Manager's History): one entry per charge, refill, top-up or reset, with who (a maker id, or the cabinet or a grown-up), what (new game, change, refill, top-up, reset), the game and version if any, coins, exact cents, the outcome (on the shelf, didn't finish, stopped, restart), the reason for a top-up or reset, the pot after, and the time. Append only, never edited (D5); it lives with the cabinet's data, not in this repo, and is backed up with it. Log it next to the `studio_session` record so the Manager's Activity can join them (§9.5).

**The live meter (M10, R7):** coins used so far, updated during a build. Read it from the session's usage as it streams (each `span.model_request_end` carries usage, see docs/cost-penguin-catch.md). If that can't be done cheaply, show the coins once at the end and drop the meter; say so in the report.

## 3. Screens

Each board id is on the canvas. "Today" names the existing screen in `screens.js` it replaces or extends.

### Boot (B1 to B4)
- **B1 Power on:** the console name (a config value; "Quarter Deck" is a placeholder, §3.1), a progress bar, "Warming up...". Never Linux text. No Wi-Fi needed to reach the shelf.
- **B2, B3 First-ever boot, once:** the controls (stick, button, ESC, COIN), then the coin pot ("The family shares one pot: 100 coins on the 1st of every month. Everyone can see who used what. 1 coin = 10 cents of real money."). Remember they've been shown; never again.
- **B4 New month:** the first boot or shelf visit on or after the 1st shows "POT IS FULL", 100 coins, and last month's per-maker totals. If last month ended negative, say it was over and that a new month starts fresh. Once per month.
- A normal boot goes straight to the shelf (S1), on the last game played (D194).

### Shelf (S1, S2, R9, S3)
- **S1 Shelf** (today: `shelf`): header with the console name and "Pot <n>" (with the coin icon). Rows in order: Make; any make results not yet viewed (D192); the games as **family rows** (D206). Each game row shows its newest version: icon, title, "by <maker>", a version tag (v2, v3) when past v1, and NEW or "1 to check" tags. Other makers' versions are indented under the game they came from (R9). Starters are tagged "starter". The Make row shows the usual cost ("~6").
- Hint line: "Stick: choose  Button: play  COIN: coins". Pick plays (through G0). Stick right on a game row opens its card (S3).
- **S2 Shelf while a make runs** (D183, D187, D199): the first row says "Claude is waiting for <name>" when a question is pending, or the build's step when building; Make is greyed with "After <name>'s game is done". While a restarted make is being collected, Make stays busy (D199).
- **S3 Game card:** title, maker, a one-line pitch, every version of this game newest first (pick one to play it), versions made from it by others, and "Change this game" (to R1).

### Coin pot (A1, A2)
- **A1 Family coin pot** (COIN on the shelf): coins left in big type with dollars in small type, a bar of 100, "Fills back up to 100 on <date>", and each maker's coins used this month as bars, most first. The usual costs ("New game: about 6", "Change: about 3"). A button to A2.
- **A2 What the pot paid for:** the ledger, newest first: who, what, coins, real cents. Includes failed makes, top-ups with their reason, and the refill. Scrolls with the stick.

### Play and after (G0 to G5)
- **G0 How to play** (new, before every game): the game's goal in a line and its controls in kid words, from the spec's Controls section (or the title D200 now asks for). Any button starts. Starters too.
- **G1 Playing:** unchanged. ESC leaves (D88).
- **G2 You check** (today: `check`): only after made games (D193), at most 2 questions per play, only rules a kid can judge in one play, no sound for now (D207). Answers: Yes, No, Not sure, Ask me later.
- **G3 Post-game, something's off** (new): shown when a check got a No. "Fix it?", the rule the kid said No to, then: "Fix that (about 3)" to R1 with the fix pre-chosen, "Change something else (about 3)", "Play again (free)", "Back to the shelf".
- **G4 Post-game, all good** (new): "Nice game!", the score and best if the game saves them, then "Play again", "Change this game (about 3)", "See other versions", and "It's good! Back to the shelf" (lit by default).
- **G5 Post-game, starter** (new): "Make it yours?" with "Make my own version (about 3)", "Play again", "Back to the shelf".
- The post-game screen shows after every game (D201). Leaving it returns to the shelf on that game (D194).

### Make a new game (M1 to M11)
- **M1 Who's making?** (today: `who`): known makers, most recent first, each with "used <n> this month"; then "Someone new". The header shows the pot.
- **M2 Someone new:** say a first name, then confirm it (D87); "Type it" opens the letters keyboard (D430, D431). Their makes come from the family pot.
- **M3 Coin check** (new): "Ready to make?", "A new game uses about 6 coins", "Some use more. It takes about 7 min", "The family pot has <n> coins", "It always finishes, even if it costs more than usual." The big lit tile is "Press COIN to start"; any other button does nothing there; "Not now" goes back. Footer: "1 coin = 10 cents. About 60 cents." If the pot holds less than 6, show L1 instead.
- **M4 Tell me, M5 Listening** (today: `say`): as today, with the AI disclosure and hold to talk (D87, D184).
- **M6 I heard / Is this right?** (today: `say`'s heard state): shown for spoken **and typed** ideas, so Enter never starts a build directly. "Yes! That's it", "Say it again", "Add more".
- **M7 Claude asks, M8 Something else** (today: `question`): as today (D190's limits). The header shows the coins used so far.
- **M9 The plan** (today: `plan`): **one screen** (D201): the idea in a line; "How to play" with the controls; "What happens" with the four rules that matter most; rules the kid will be asked about tagged "you check", with the key on the hint line; "+ <n> more. Stick right: read them all." opens the full rules in the reader. "Build it! (about 6)" and "Change it". The agent picks the four rules; that's a brief change (§4).
- **M10 Making it** (today: `progress`): the four-step track Plan, Build, Test, Done, forward only (D198), the current step's line in kid words, the coins used so far and the time left, and "ESC: play something else meanwhile".
- **M11 Ready** (today: `result`): title, "by <name>", "This game used <n> coins (<c>c)", "That's about usual" or L4's "more than usual" line, "Family pot now <n>", "Play it now" (to G0), "Back to the shelf".

### Change a game (R1 to R9)
- **R1 Who's changing?:** each maker with what it means: the game's maker "makes version <n+1>", anyone else "makes <name>'s own version", and "Someone new".
- **R2 Someone else's game:** "This is <maker>'s game. Your changes make a new game, just yours. <maker>'s stays the same." with "OK, make mine".
- **R3 Coin check, change:** as M3 with "A change uses about 3 coins", about 4 minutes, and "Version <n> stays saved, whatever happens."
- **R4 What to change:** "It's Claude again!", then the fix for a No answer first if there is one, "Tell Claude something else" (hold to talk), "Look at the plan first".
- **R5 Claude asks:** the same tiles as M7; Claude asks only about what's unclear (§8.2).
- **R6 What changes:** the changed rules (old struck through, new beside), "Staying the same: <list>, and <n> more", "Version 1 stays saved", "Change it! (about 3)" and "Not quite".
- **R7 Changing it:** as M10, with the steps Plan, Change, Test, Done.
- **R8 Ready:** "Version <n> is ready!", what changed in a line, "Version <n-1> is still saved", the coins used and the pot after.
- **R9:** the shelf with the new version as its game's newest row, or the other maker's version indented under the original.

### The pot's limits (L1 to L5)
- **L1 Pot too low for a new game** (instead of M3 when the pot is under 6): "The pot is almost empty", what it has, what a new game needs, "A small change (about 3) still fits", the refill date; "Change a game instead", "Who used the coins?" (A1), "Play a game". Under 3, a change gets the same screen and L2's options.
- **L2 Pot is empty** (at 0 or below): "POT IS EMPTY", no making until the 1st, the per-maker totals, "Playing games is always free.", "Play a game". Hint: "A grown-up can add coins".
- **L3 Went over the pot:** the result screen of a make that cost more than the pot held: the cost, what the pot had, "So the pot is now -<n>", "Claude finished your game anyway", "No more making this month. On <date> the pot starts fresh at 100."
- **L4 Cost more than usual:** the result screen when a make costs over 1.5 times its usual cost: "That's more than usual (about 6)" and a one-line reason in kid words, from the session's events (for example, "Claude had to fix it 3 times before every rule worked").
- **L5 The Studio is resting:** only if the workspace's real limit refuses a session. Making stops until the 1st; playing works.

### Errors (E1 to E12)
- **E1, E2 No Wi-Fi:** the shelf header says "No Wi-Fi"; Make reads "Needs Wi-Fi right now"; picking it says Claude can't be reached, no coins were used, and the games all work.
- **E11, E12 Not connected yet (D252):** a cabinet with no key yet (the Picade before `connect-picade.sh`). The shelf header says "Not connected"; Make reads "Not connected to Claude yet"; picking it says "Not connected to Claude yet. A grown-up needs to finish setting up.", that no coins were used, and that the games all work. Never "No Wi-Fi": the cabinet may have Wi-Fi.
- **E3 A make failed:** "Sorry! It didn't come out right." It was Claude's slip, not the kid's; the idea and answers are saved; "The try still used <n> coins (<c>c). Real work costs real money, even when it doesn't work out." Then "Try again, same idea (about 6)" (back to M3, with the idea filled in) and "Back to the shelf". The same words go on its shelf entry (D192).
- **E4 Restarting, E5 Restarted on a question, E6 Restarted while building:** D189 and D191's cases, in this wording. E5 says the idea is saved and what the questions used. E6 says Claude kept going and to look on the shelf.
- **E7 Still there?:** D188's last minute, with a countdown on the hint line.
- **E8 ESC during a question** (today: `leave`): "Keep going", "Come back later" (it waits about 10 minutes), "Stop making this game" (coins used so far stay used).
- **E9 Didn't hear:** hold a button the whole time you talk; "Try again" and "Type it instead (F1, the Picade's ENT)" (D431).
- **E10 Let's pick another idea:** when screening refuses an idea (Phase 3): two suggested ideas, "Something else", "Back to the shelf". No coins are used.

### Cabinet Manager: Coin pot page
- A new tab, "Coin pot", next to Activity and Health. It shows the month: coins left, dollars spent of $10, a bar, the refill date, and per-maker totals with their number of makes.
- **Add coins or reset:** pick add or reset, the coins (for add), and a reason (required, shown to the kids in A2). A confirm shows the dollar amount. Warn when this month's total would pass the workspace limit ($15, D211).
- History: the ledger, with real cost, outcome and pot after. Rules, read-only: the numbers in §2.
- Through the Manager API (§9.4), paired as today. Nothing here is at the cabinet.

## 4. What else changes

- **The Studio brief (agent):** the plan the agent shows must lead with the idea, the controls, and the four most important rules, and mark which rules the kid will check (D201). You-check rules are at most two per play and must be visible in one play, with nothing about sound for now (D207). Apply it like D190 and D200 (the director's call, after a dry run).
- **makeCart and the service:** the coin check gate (D203), the charge at the end (D202), ledger entries, the live coin count (if feasible), and the version and branch rules for changes (D206; `studio fork` isn't built yet, D183).
- **D187's tile wording** changes to "Claude is waiting for <name>" (D201).
- **Geoff, once:** raise the cabinet workspace's limit to $15 in the Claude Console (D204, D211).

## 5. Done when

- Every board on the canvas has a matching launcher screen, or is listed as not built with a reason. Drive it through `scripts/drive.js` against the replay (D186), with a fit-report check at every step.
- The coin rules in §2 have tests: the start gate at 6 and 3 (5 coins: a change starts, a new game doesn't), the real charge, rounding, no refunds on a failed make, an overrun that finishes and leaves the pot negative, the reset to 100 on the 1st with a negative wiped, and a Manager top-up with a reason showing in A2.
- One live make and one live change run against the real API (the director's call) and land in the ledger with the right cents.
