// Publishes a package dir with provenance unless its exact version already
// exists on the npm registry. Keeps re-tags of older versions from going red.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(process.argv[2]);
const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
const { name, version } = pkg;
if (!name || !version) {
  console.error(`publish-if-new: ${dir}/package.json missing name/version`);
  process.exit(1);
}

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const spawnOpts = {
  stdio: "pipe",
  shell: process.platform === "win32",
};

let exists = false;
try {
  execFileSync(npmBin, ["view", `${name}@${version}`, "version"], spawnOpts);
  exists = true;
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("publish-if-new: npm executable not found");
    process.exit(1);
  }
  const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  if (!output.includes("E404")) {
    console.error(`publish-if-new: registry lookup failed for ${name}@${version} (${err.code ?? "?"}): ${output.trim()}`);
    process.exit(1);
  }
}

if (exists) {
  console.log(`${name}@${version} already published — skipping.`);
  process.exit(0);
}

execFileSync(npmBin, ["publish", "--provenance", "--access", "public"], {
  cwd: dir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`${name}@${version} published.`);
