// @ts-check
// Writes that survive the plug being pulled (D370). The kids switch the cabinet off at the wall; the card has no
// fallback (D339). On ext4 a file written and renamed into place can come back empty after a cut, and an append can
// come back torn; the QEMU power rehearsal (scripts/cabinet-card/test/power-rehearsal.sh) is how we know.
import fs from "node:fs";
import path from "node:path";

/** Flush a folder's entries (a rename) to disk. Best effort: some filesystems refuse fsync on a folder. */
function syncDir(/** @type {string} */ dir) {
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // e.g. EISDIR/EINVAL on filesystems that don't sync folders
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Replace a file whole: the old contents or the new, never empty or half, whenever the power goes.
 * @param {string} file @param {string | Buffer} data
 */
export function writeFileDurable(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, typeof data === "string" ? Buffer.from(data) : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  syncDir(dir);
}

/** @param {string} file @param {unknown} value @param {number} [indent] */
export function writeJsonDurable(file, value, indent = 2) {
  writeFileDurable(file, `${JSON.stringify(value, null, indent)}\n`);
}

/**
 * Append one line and flush it. If a cut left the file ending mid-line, the new line starts on its own, so the torn
 * one stays torn (readers skip it) and this one is whole: without that, the next line would be glued to the torn one
 * and lost with it.
 * @param {string} file @param {string} line without its newline
 */
export function appendLineDurable(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a+");
  try {
    const size = fs.fstatSync(fd).size;
    let lead = "";
    if (size > 0) {
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      if (last[0] !== 0x0a) lead = "\n";
    }
    fs.writeSync(fd, `${lead}${line}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Flush every file and folder under DIR to disk: for files another tool wrote (tar, a recursive copy), before they're
 * relied on. A session's cart came back with an empty cart.json after a cut without this (D370).
 * @param {string} dir
 */
export function syncTree(dir) {
  const visit = (/** @type {string} */ p) => {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) visit(path.join(p, n));
    let fd;
    try {
      fd = fs.openSync(p, "r");
      fs.fsyncSync(fd);
    } catch {
      // a folder some filesystems won't fsync
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  visit(dir);
  syncDir(path.dirname(dir));
}
