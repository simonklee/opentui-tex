import { $ } from "bun"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const usage = "Usage: bun run release [patch|minor|major] [--dry-run]"
const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage)
  process.exit(0)
}
const dryRun = args.includes("--dry-run")
const bumps = args.filter((arg) => arg !== "--dry-run")
const index = ["major", "minor", "patch"].indexOf(bumps[0] ?? "patch")
if (bumps.length > 1 || index < 0) throw new Error(usage)

const root = join(import.meta.dir, "..")
const run = (...args: Parameters<typeof $>) => $(...args).cwd(root)
if ((await run`git branch --show-current`.text()).trim() !== "main") throw new Error("Release from main, not another branch")
const gitDirectory = (await run`git rev-parse --absolute-git-dir`.text()).trim()
if (["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].some((state) => existsSync(join(gitDirectory, state))) ||
    (await run`git diff --name-only --diff-filter=U`.text()).trim()) {
  throw new Error("Finish the current Git operation and resolve conflicts before releasing")
}
if ((await run`git status --porcelain -- package.json bun.lock`.text()).trim()) {
  throw new Error("package.json and bun.lock must be clean. Commit their changes before releasing.")
}

const file = Bun.file(join(root, "package.json"))
const pkg = await file.json()
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
  throw new Error("The release command requires a stable major.minor.patch version")
}
const parts = pkg.version.split(".").map(Number)
parts[index]++
parts.fill(0, index + 1)
if (!parts.every(Number.isSafeInteger)) throw new Error("Version number exceeds the supported range")
const version = parts.join(".")
const tag = `v${version}`
if ((await run`git tag --list ${tag}`.text()).trim()) throw new Error(`Local tag ${tag} already exists`)

const remotes = (await run`git remote get-url --push --all origin`.text()).trim().split("\n")
if (remotes.length !== 1) throw new Error("origin must have exactly one push URL for an atomic release")
const remote = remotes[0]
await run`gh auth status`.quiet()
const repository = (await run`gh repo view ${remote} --json nameWithOwner --jq .nameWithOwner`.text()).trim()
await run`git fetch --no-tags ${remote} main`.quiet()
if ((await run`git merge-base --is-ancestor FETCH_HEAD HEAD`.quiet().nothrow()).exitCode !== 0) {
  throw new Error("main is behind or has diverged from origin. Update it before releasing.")
}
if ((await run`git ls-remote --tags ${remote} ${`refs/tags/${tag}`}`.text()).trim()) {
  throw new Error(`Remote tag ${tag} already exists`)
}

console.log(`${dryRun ? "Dry run: " : ""}${pkg.version} -> ${version}`)
console.log("Release committed changes only; other local changes stay untouched and are not included.")
console.log(`Commit package.json and bun.lock, push main and ${tag} to ${repository}, wait for release.yml, then create the GitHub release.`)
if (dryRun) process.exit(0)

await Bun.write(file, JSON.stringify({ ...pkg, version }, null, 2) + "\n")
await run`bun run version`
await run`git commit --only package.json bun.lock -m ${`release: ${tag}`}`
const commit = (await run`git rev-parse HEAD`.text()).trim()
await run`git tag -a ${tag} ${commit} -m ${tag}`
if ((await run`git push --atomic --no-follow-tags origin ${`${commit}:refs/heads/main`} ${`refs/tags/${tag}:refs/tags/${tag}`}`.nothrow()).exitCode !== 0) {
  throw new Error(`Push failed. The local release commit and ${tag} remain intact. Resolve the Git error and push them instead of bumping again.`)
}

console.log(`Pushed ${tag}. The tag push starts npm publishing.`)
let workflow: { databaseId: number; url: string } | undefined
for (let attempt = 0; attempt < 24; attempt++) {
  const runs = await run`gh run list --repo ${repository} --workflow release.yml --event push --branch ${tag} --commit ${commit} --limit 1 --json databaseId,url`.json()
  workflow = runs[0]
  if (workflow) break
  await Bun.sleep(5_000)
}
if (!workflow) throw new Error(`${tag} is pushed, but its release workflow has not appeared. Check https://github.com/${repository}/actions/workflows/release.yml before retrying.`)
console.log(workflow.url)
if ((await run`gh run watch ${workflow.databaseId} --repo ${repository} --exit-status --interval 20`.nothrow()).exitCode !== 0) {
  throw new Error(`The release workflow failed or was interrupted. Inspect ${workflow.url} and retry the existing run instead of bumping again.`)
}
const published = await run`gh run view ${workflow.databaseId} --repo ${repository} --json jobs --jq '.jobs[] | select(.name == "publish") | .conclusion'`.text()
if (published.trim() !== "success") throw new Error("The npm publish job did not succeed; no GitHub release was created")

const directory = await mkdtemp(join(tmpdir(), "opentui-tex-release-"))
try {
  await run`gh run download ${workflow.databaseId} --repo ${repository} --name npm-packages --dir ${directory}`
  const names = [pkg.name, `${pkg.name}-native-source`, ...Object.keys(pkg.optionalDependencies)]
  const filenames = names.map((name) => `${name.replace("@", "").replace("/", "-")}-${version}.tgz`).sort()
  if (filenames.length !== 10 || JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(filenames)) {
    throw new Error("Expected all ten release tarballs from the successful workflow")
  }
  const tarballs = filenames.map((name) => join(directory, name))
  await run`gh release create ${tag} ${tarballs} --repo ${repository} --verify-tag --title ${tag} --generate-notes`
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log(`Released ${pkg.name}@${version}`)
