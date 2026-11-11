// The address macOS's shared network gave one of the VM's cards (D241), or nothing yet.
//   node scripts/virtual-cabinet/vm-addr.mjs [MAC]     default: the mini's private card
// GSA_DHCP_LEASES points it at another leases file, for tests.
import { existsSync, readFileSync } from "node:fs";
import { leaseFor, MINI_LINK_MAC } from "./lib.mjs";

const file = process.env.GSA_DHCP_LEASES || "/var/db/dhcpd_leases";
const ip = existsSync(file) ? leaseFor(readFileSync(file, "utf8"), process.argv[2] || MINI_LINK_MAC) : null;
if (ip) console.log(ip);
process.exit(ip ? 0 : 1);
