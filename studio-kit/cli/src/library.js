// The dev cart library (D14): its own git repo under ~/game-studio-data/carts.
// Append-only: a new cart never replaces an existing folder, and every version
// is a commit.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileDurable } from "./durable.js";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Studio",
  GIT_AUTHOR_EMAIL: "studio@game-studio-arcade.invalid",
  GIT_COMMITTER_NAME: "Studio",
  GIT_COMMITTER_EMAIL: "studio@game-studio-arcade.invalid",
  // Objects, refs and the index on disk before a commit returns: a power cut must not leave the library with an
  // empty object file, which breaks the whole repository (D337a). Through the environment, so .git/config, which
  // is the family's data, is never touched.
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.fsync",
  GIT_CONFIG_VALUE_0: "added",
  GIT_CONFIG_KEY_1: "core.fsyncMethod",
  GIT_CONFIG_VALUE_1: "fsync",
};

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();
}

/** @param {string} root */
export function ensureLibrary(root) {
  fs.mkdirSync(root, { recursive: true });
  const head = path.join(root, ".git", "HEAD");
  if (!fs.existsSync(path.join(root, ".git"))) {
    git(root, ["init", "-q", "-b", "main"]);
    writeFileDurable(path.join(root, "README.md"), "# Dev cart library\n\nOne folder per cart. Never delete; every version is a commit.\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-q", "-m", "Start the dev cart library"]);
    // core.fsync covers objects, refs and the index, not the files `git init` writes. A power cut seconds after the
    // first make left .git/HEAD empty, and git no longer saw a repository (the QEMU power rehearsal, D370). Once, here.
    try {
      execFileSync("sync");
    } catch {}
  } else if (!fs.existsSync(head) || fs.statSync(head).size === 0) {
    // A library whose creation was cut off like that: HEAD back to its only branch. Nothing else is touched (D5).
    writeFileDurable(head, "ref: refs/heads/main\n");
  }
  return root;
}

/** "Candy Pop!" -> "candy-pop" */
export function slugify(title) {
  const s = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "cart";
}

/** A free cart id in the library: the slug, or slug-2, slug-3… */
export function freeId(root, wanted) {
  const base = slugify(wanted);
  let id = base;
  for (let n = 2; fs.existsSync(path.join(root, id)); n++) id = `${base}-${n}`;
  return id;
}

/** Title from a spec's first heading: "# Candy Pop   A · null · sesn_…" -> "Candy Pop" */
export function specTitle(specText) {
  const m = String(specText ?? "").match(/^#\s+(.+)$/m);
  return m ? m[1].split(/\s{2,}|\s[·|]\s/)[0].trim() : null;
}

/**
 * Copy a built cart into the library as a new cart (version 1) and commit it.
 * @param {{root: string, cartDir: string, cartJson: object, message: string}} o
 * @returns {{id: string, dir: string, commit: string}}
 */
export function commitNewCart(o) {
  ensureLibrary(o.root);
  const wanted = /** @type {any} */ (o.cartJson).id || /** @type {any} */ (o.cartJson).title || "cart";
  const id = freeId(o.root, wanted);
  const dest = path.join(o.root, id);
  // Key frames are regenerable (D62): the library keeps playtest.json, never the PNGs.
  fs.cpSync(o.cartDir, dest, { recursive: true, filter: (src) => path.basename(src) !== "playtest-frames" });
  writeFileDurable(path.join(dest, "cart.json"), JSON.stringify({ ...o.cartJson, id }, null, 2) + "\n");
  git(o.root, ["add", "--", id]);
  git(o.root, ["commit", "-q", "-m", o.message.replace("{id}", id)]);
  return { id, dir: dest, commit: git(o.root, ["rev-parse", "HEAD"]) };
}
