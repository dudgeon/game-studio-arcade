// The cabinet's network record (D242), run on the mini against stand-ins for ip, arping and ping.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NETWATCH = path.join(REPO, "cabinet/provision/files/arcade-netwatch");

const IP = `#!/bin/bash
case "$*" in
  "-o -4 addr show scope global")
    echo "2: eth0    inet 192.168.86.97/24 brd 192.168.86.255 scope global dynamic noprefixroute eth0"
    [ -e "$STUB/no-link" ] || echo "3: eth1    inet 192.168.64.5/24 brd 192.168.64.255 scope global dynamic noprefixroute eth1" ;;
  "-4 route show default") echo "default via 192.168.86.1 dev eth0 proto dhcp src 192.168.86.97 metric 100" ;;
  "-4 route get "192.168.86.*) echo "$4 dev eth0 src 192.168.86.97 uid 0" ;;
  "-4 route get "192.168.64.*) echo "$4 dev eth1 src 192.168.64.5 uid 0" ;;
  "-4 route get "*) echo "$4 via 192.168.86.1 dev eth0 src 192.168.86.97 uid 0" ;;
  "neigh flush "*) echo "ip $*" >> "$STUB/calls" ;;
  *) echo "unexpected ip $*" >&2; exit 2 ;;
esac
`;

// Each probe takes the next answer from STUB/<target>; with none left it answers up.
const ARPING = `#!/bin/bash
echo "arping $*" >> "$STUB/calls"
for a in "$@"; do [ "$a" = -U ] && exit 0; done
t="\${@: -1}"
f="$STUB/$t"
[ -s "$f" ] || exit 0
v="$(head -1 "$f")"; tail -n +2 "$f" > "$f.n"; mv "$f.n" "$f"
[ "$v" = up ]
`;

function run(rounds, answers = {}, opts = {}) {
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), "netwatch-"));
  const bin = path.join(stub, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ip"), IP, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "arping"), ARPING, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "ping"), "#!/bin/bash\n[ ! -e \"$STUB/router-down\" ]\n", { mode: 0o755 });
  fs.writeFileSync(path.join(stub, "mini-addrs"), "192.168.86.96\nfe80::1\n10.0.0.9\n");
  for (const [t, list] of Object.entries(answers)) fs.writeFileSync(path.join(stub, t), `${list.join("\n")}\n`);
  if (opts.noLink) fs.writeFileSync(path.join(stub, "no-link"), "");
  if (opts.routerDown) fs.writeFileSync(path.join(stub, "router-down"), "");
  const out = execFileSync("/bin/bash", [NETWATCH], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, STUB: stub, NETWATCH_ROUNDS: String(rounds), NETWATCH_INTERVAL: "0", NETWATCH_COUNT_EVERY: String(opts.countEvery ?? 100), NETWATCH_MINI_ADDRS: path.join(stub, "mini-addrs") },
  });
  const calls = fs.existsSync(path.join(stub, "calls")) ? fs.readFileSync(path.join(stub, "calls"), "utf8").trim().split("\n") : [];
  return { lines: out.trim().split("\n").filter(Boolean), calls };
}

test("a steady network makes one CHANGE line, naming both paths to the mini", () => {
  const { lines } = run(5);
  assert.deepEqual(lines, ["netwatch CHANGE eth0.router=up eth0.mini=up eth1.mini=up"]);
});

test("it probes the mini by ARP only, on the link each address belongs to", () => {
  const { calls } = run(1);
  assert.ok(calls.includes("arping -q -c 1 -w 2 -I eth0 192.168.86.96"));
  assert.ok(calls.includes("arping -q -c 1 -w 2 -I eth1 192.168.64.1"));
  assert.ok(!calls.some((c) => c.includes("10.0.0.9")), "an address behind a gateway isn't the mini's link");
});

test("it announces itself on the bridged interface every round, and only there", () => {
  const { calls } = run(3);
  assert.equal(calls.filter((c) => c === "arping -q -U -c 1 -I eth0 192.168.86.97").length, 3);
  assert.ok(!calls.some((c) => c.includes("-U") && c.includes("eth1")));
});

test("a drop on the bridged path is logged when it starts and ends, with one nudge after its second round", () => {
  const { lines, calls } = run(6, { "192.168.86.96": ["up", "DOWN", "DOWN", "DOWN", "up", "up"] });
  assert.deepEqual(lines, [
    "netwatch CHANGE eth0.router=up eth0.mini=up eth1.mini=up",
    "netwatch CHANGE eth0.router=up eth0.mini=DOWN eth1.mini=up",
    "netwatch NUDGE eth0: forgot 192.168.86.96's ARP entry and announced 192.168.86.97 three times",
    "netwatch CHANGE eth0.router=up eth0.mini=up eth1.mini=up",
  ]);
  assert.equal(calls.filter((c) => c === "ip neigh flush to 192.168.86.96 dev eth0").length, 1);
  // Three rounds' announcements, three extra for the nudge, three more rounds.
  assert.equal(calls.filter((c) => c.startsWith("arping -q -U")).length, 9);
});

test("a second drop gets its own nudge", () => {
  const { lines } = run(7, { "192.168.86.96": ["DOWN", "DOWN", "up", "DOWN", "DOWN", "DOWN", "up"] });
  assert.equal(lines.filter((l) => l.includes("NUDGE")).length, 2);
});

test("a drop on the private link is recorded but not nudged", () => {
  const { lines, calls } = run(3, { "192.168.64.1": ["DOWN", "DOWN", "DOWN"] });
  assert.deepEqual(lines, ["netwatch CHANGE eth0.router=up eth0.mini=up eth1.mini=DOWN"]);
  assert.ok(!calls.some((c) => c.startsWith("ip neigh")));
});

test("COUNT lines total each path's rounds", () => {
  const { lines } = run(4, { "192.168.86.96": ["up", "DOWN", "up", "up"] }, { countEvery: 2, routerDown: true });
  assert.deepEqual(lines.filter((l) => l.includes("COUNT")), [
    "netwatch COUNT eth0.router=0/2 eth0.mini=1/2 eth1.mini=2/2",
    "netwatch COUNT eth0.router=0/4 eth0.mini=3/4 eth1.mini=4/4",
  ]);
});

test("with no private link it watches the bridged path alone", () => {
  const { lines } = run(2, {}, { noLink: true });
  assert.deepEqual(lines, ["netwatch CHANGE eth0.router=up eth0.mini=up"]);
});

test("it runs on the mini's bash 3, as tested", () => {
  assert.match(execFileSync("/bin/bash", ["--version"], { encoding: "utf8" }), /version [3-9]\./);
  assert.ok(!fs.readFileSync(NETWATCH, "utf8").includes("declare -A"), "no associative arrays: bash 3 has none");
});
