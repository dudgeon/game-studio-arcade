// Test helpers: a throwaway cart library (a git repo, like the CLI's) and logs folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "library");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

/** @param {string} cwd @param {string[]} args */
export const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();

/** A fresh data folder: carts/ (git, with the fixture carts committed) and logs/. */
export function makeData() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-player-"));
  const carts = path.join(root, "carts");
  const logs = path.join(root, "logs");
  fs.cpSync(FIXTURES, carts, { recursive: true });
  git(carts, ["init", "-q", "-b", "main"]);
  git(carts, ["add", "."]);
  git(carts, ["commit", "-q", "-m", "fixtures"]);
  return { root, carts, logs, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** @param {string} logs @param {string} type @returns {any[]} */
export function readRecords(logs, type) {
  const f = path.join(logs, `${type}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
