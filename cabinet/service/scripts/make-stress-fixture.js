#!/usr/bin/env node
// Writes the long-strings fixture for scripts/flows/stress.drive: make-stress-fixture.js OUT_DIR
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeStressFixture } from "../test-support/stress.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: make-stress-fixture.js OUT_DIR");
  process.exit(2);
}
const from = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../studio-kit/cli/fixtures/penguin-catch");
console.log(writeStressFixture(from, path.resolve(out)));
