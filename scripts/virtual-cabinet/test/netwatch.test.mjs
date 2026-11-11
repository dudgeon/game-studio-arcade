// The cabinet's network record (D242, D245), run on the mini against stand-ins for ip, arping and ping.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NETWATCH = path.join(REPO, "cabinet/provision/files/arcade-netwatch");

// STUB/no-link drops the private card; STUB/no-subnet-route drops eth0's subnet route, as D245 saw.
const IP = `#!/bin/bash
case "$*" in
  "-o -4 addr show scope global")
    echo "2: eth0    inet 192.168.86.97/24 brd 192.168.86.255 scope global dynamic noprefixroute eth0"
    [ -e "$STUB/no-link" ] || echo "3: eth1    inet 192.168.64.5/24 brd 192.168.64.255 scope global dynamic noprefixroute eth1" ;;
  "-4 route show default") echo "default via 192.168.86.1 dev eth0 proto dhcp src 192.168.86.97 metric 100" ;;
  "-4 route show table main")
    echo "default via 192.168.86.1 dev eth0 proto dhcp src 192.168.86.97 metric 100"
    [ -e "$STUB/no-link" ] || echo "192.168.64.0/24 dev eth1 proto kernel scope link src 192.168.64.5 metric 101"
    [ -e "$STUB/no-subnet-route" ] || echo "192.168.86.0/24 dev eth0 proto kernel scope link src 192.168.86.97 metric 100" ;;
  *) echo "ip $*" >> "$STUB/calls"; echo "unexpected ip $*" >&2; exit 2 ;;
esac
`;

// Each probe takes the next answer from STUB/<target>; with none left it answers up.
const ARPING = `#!/bin/bash
echo "arping $*" >> "$STUB/calls"
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
  for (const flag of ["no-link", "router-down", "no-subnet-route"]) if (opts[flag]) fs.writeFileSync(path.join(stub, flag), "");
  const out = execFileSync("/bin/bash", [NETWATCH], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, STUB: stub, NETWATCH_ROUNDS: String(rounds), NETWATCH_INTERVAL: "0", NETWATCH_COUNT_EVERY: String(opts.countEvery ?? 100), NETWATCH_MINI_ADDRS: path.join(stub, "mini-addrs") },
  });
  const calls = fs.existsSync(path.join(stub, "calls")) ? fs.readFileSync(path.join(stub, "calls"), "utf8").trim().split("\n") : [];
  return { lines: out.trim().split("\n").filter(Boolean), calls };
}

const STEADY = "netwatch CHANGE eth0.router=up eth0.subnet=up eth0.mini=up eth1.subnet=up eth1.mini=up";

test("a steady network makes one CHANGE line, naming both paths to the mini", () => {
  assert.deepEqual(run(5).lines, [STEADY]);
});

test("it probes the mini by ARP only, inside each interface's own subnet", () => {
  const { calls } = run(1);
  assert.deepEqual(calls, ["arping -q -c 1 -w 2 -I eth0 192.168.86.96", "arping -q -c 1 -w 2 -I eth1 192.168.64.1"]);
});

test("it only watches: no announcements, no flushes (D245)", () => {
  const { calls } = run(4, { "192.168.86.96": ["DOWN", "DOWN", "DOWN", "DOWN"] });
  assert.ok(calls.every((c) => c.startsWith("arping -q -c 1 -w 2")), calls.join("\n"));
  assert.ok(!fs.readFileSync(NETWATCH, "utf8").match(/^[^#]*arping[^\n]*-U/m), "no gratuitous ARP");
});

test("a lost subnet route is recorded, and the mini is still probed on its link (D245)", () => {
  const { lines, calls } = run(2, {}, { "no-subnet-route": true });
  assert.deepEqual(lines, ["netwatch CHANGE eth0.router=up eth0.subnet=DOWN eth0.mini=up eth1.subnet=up eth1.mini=up"]);
  assert.ok(calls.includes("arping -q -c 1 -w 2 -I eth0 192.168.86.96"));
});

test("a drop on the bridged path is logged when it starts and when it ends", () => {
  const { lines } = run(6, { "192.168.86.96": ["up", "DOWN", "DOWN", "DOWN", "up", "up"] });
  assert.deepEqual(lines, [STEADY, STEADY.replace("eth0.mini=up", "eth0.mini=DOWN"), STEADY]);
});

test("a drop on the private link is recorded", () => {
  assert.deepEqual(run(3, { "192.168.64.1": ["DOWN", "DOWN", "DOWN"] }).lines, [STEADY.replace("eth1.mini=up", "eth1.mini=DOWN")]);
});

test("COUNT lines total each path's rounds", () => {
  const { lines } = run(4, { "192.168.86.96": ["up", "DOWN", "up", "up"] }, { countEvery: 2, "router-down": true });
  assert.deepEqual(lines.filter((l) => l.includes("COUNT")), [
    "netwatch COUNT eth0.router=0/2 eth0.subnet=2/2 eth0.mini=1/2 eth1.subnet=2/2 eth1.mini=2/2",
    "netwatch COUNT eth0.router=0/4 eth0.subnet=4/4 eth0.mini=3/4 eth1.subnet=4/4 eth1.mini=4/4",
  ]);
});

test("with no private card it watches the bridged path alone", () => {
  assert.deepEqual(run(2, {}, { "no-link": true }).lines, ["netwatch CHANGE eth0.router=up eth0.subnet=up eth0.mini=up"]);
});

test("its unit starts at boot without waiting for network-online, which takes 2 minutes and fails here", () => {
  const unit = fs.readFileSync(path.join(REPO, "cabinet/provision/files/arcade-netwatch.service"), "utf8");
  const directives = unit.split("\n").filter((l) => !l.startsWith("#"));
  assert.ok(directives.includes("WantedBy=multi-user.target"));
  assert.ok(!directives.some((l) => /^(After|Wants|Requires)=.*network-online/.test(l)));
});

test("it runs on the mini's bash 3, as tested", () => {
  assert.match(execFileSync("/bin/bash", ["--version"], { encoding: "utf8" }), /version [3-9]\./);
  assert.ok(!fs.readFileSync(NETWATCH, "utf8").includes("declare -A"), "no associative arrays: bash 3 has none");
});
