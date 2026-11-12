#!/usr/bin/env node
// The summary of a cabinet's screening log (D273): checks, passes, redirects, timeouts.
//   node cabinet/service/scripts/screening-summary.mjs [LOGS_DIR or screening.jsonl]   (default: this machine's data dir)
//   on a cabinet: cabinet/vm/drive ssh 'node /opt/arcade/current/cabinet/service/scripts/screening-summary.mjs /var/lib/arcade/logs'
import fs from "node:fs";
import path from "node:path";
import { dataDir, dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { summarize } from "../src/screening.js";

const arg = process.argv[2] ?? dataPaths(dataDir()).logs;
const file = fs.existsSync(arg) && fs.statSync(arg).isDirectory() ? path.join(arg, "screening.jsonl") : arg;
console.log(JSON.stringify({ file, ...summarize(readLog(file)) }, null, 2));
