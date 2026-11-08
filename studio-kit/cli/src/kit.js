// Build the studio kit and make sure it's uploaded once per content hash (D42).
import fs from "node:fs";
import path from "node:path";
import { buildKit } from "../../managed-agent/scripts/pack-kit.js";

/**
 * @param {{api: import("./api.js").StudioApi, cacheFile: string, out: string,
 *          build?: typeof buildKit, log?: (s: string) => void}} o
 * @returns {Promise<{fileId: string, hash: string, uploaded: boolean, missing: string[]}>}
 */
export async function ensureKitUploaded(o) {
  const build = o.build ?? buildKit;
  const log = o.log ?? (() => {});
  const kit = build({ out: o.out });
  const cache = readCache(o.cacheFile);
  const hit = cache[kit.hash];
  if (hit?.file_id) {
    log(`kit ${kit.hash.slice(0, 12)} already uploaded as ${hit.file_id}`);
    return { fileId: hit.file_id, hash: kit.hash, uploaded: false, missing: kit.missing };
  }
  const file = await o.api.uploadFile(kit.out, "studio-kit.tgz");
  cache[kit.hash] = { file_id: file.id, uploaded_at: new Date().toISOString(), files: kit.fileCount, bytes: kit.bytes };
  fs.mkdirSync(path.dirname(o.cacheFile), { recursive: true });
  fs.writeFileSync(o.cacheFile, JSON.stringify(cache, null, 2) + "\n");
  log(`kit ${kit.hash.slice(0, 12)} uploaded as ${file.id}`);
  return { fileId: file.id, hash: kit.hash, uploaded: true, missing: kit.missing };
}

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
