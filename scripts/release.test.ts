import { $ } from "bun"
import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, join } from "node:path"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function setup(version = "1.2.3") {
  const directory = await mkdtemp(join(tmpdir(), "opentui-tex-release-"))
  directories.push(directory)
  const repo = join(directory, "repo")
  const origin = join(directory, "origin.git")
  const bin = join(directory, "bin")
  const log = join(directory, "gh.jsonl")
  await mkdir(repo)
  await mkdir(bin)
  await Bun.write(log, "")
  for (const script of ["release.ts", "version.ts"]) {
    await Bun.write(join(repo, "scripts", script), Bun.file(join(import.meta.dir, script)))
  }
  const root = await Bun.file(join(import.meta.dir, "..", "package.json")).json()
  const optionalDependencies = Object.fromEntries(Object.keys(root.optionalDependencies).map((name) => [name, version]))
  await Bun.write(join(repo, "package.json"), JSON.stringify({
    name: root.name, version, private: true, type: "module", optionalDependencies,
    scripts: { release: "bun scripts/release.ts", version: "bun scripts/version.ts && bun scripts/update-lock.ts" },
  }, null, 2) + "\n")
  await Bun.write(join(repo, "scripts", "update-lock.ts"), `
const manifest = await Bun.file("package.json").json()
await Bun.write("bun.lock", JSON.stringify({
  lockfileVersion: 1, configVersion: 1,
  workspaces: { "": { name: manifest.name, optionalDependencies: manifest.optionalDependencies } },
  packages: Object.fromEntries(Object.entries(manifest.optionalDependencies).map(([name, version]) => [name, [name + "@" + version, "", {}]])),
}, null, 2) + "\\n")
`)
  await $`${process.execPath} scripts/update-lock.ts`.cwd(repo).quiet()
  await Bun.write(join(repo, "tracked.txt"), "initial\n")
  const gh = join(bin, "gh")
  await Bun.write(gh, `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const args = process.argv.slice(2)
appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify(args) + "\\n")
if (args[0] === "auth" && args[1] === "status") process.exit(0)
else if (args[0] === "repo" && args[1] === "view") console.log("simonklee/opentui-tex")
else if (args[0] === "run" && args[1] === "list") console.log(JSON.stringify([{ databaseId: 123, url: "https://github.com/simonklee/opentui-tex/actions/runs/123" }]))
else if (args[0] === "run" && args[1] === "watch") process.exit(process.env.RELEASE_TEST_FAIL_WATCH ? 1 : 0)
else if (args[0] === "run" && args[1] === "view") console.log(process.env.RELEASE_TEST_PUBLISH ?? "success")
else if (args[0] === "run" && args[1] === "download") {
  const directory = args[args.indexOf("--dir") + 1]
  mkdirSync(directory, { recursive: true })
  const manifest = await Bun.file("package.json").json()
  const names = [manifest.name, manifest.name + "-native-source", ...Object.keys(manifest.optionalDependencies)]
  if (process.env.RELEASE_TEST_MISSING_ARTIFACT) names.pop()
  for (const name of names) writeFileSync(join(directory, name.replace("@", "").replace("/", "-") + "-" + manifest.version + ".tgz"), "fixture tarball")
  if (process.env.RELEASE_TEST_FAIL_DOWNLOAD) process.exit(1)
} else if (args[0] === "release" && args[1] === "create") {
  const files = args.filter((arg) => arg.endsWith(".tgz"))
  if (files.length !== 10 || files.some((file) => !existsSync(file))) throw new Error("Expected ten existing release assets")
  if (process.env.RELEASE_TEST_FAIL_CREATE) process.exit(1)
  console.log("Created " + args[2])
} else throw new Error("Unexpected gh invocation: " + args.join(" "))
`)
  await chmod(gh, 0o755)
  const env: NodeJS.ProcessEnv = {
    ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, RELEASE_TEST_LOG: log,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", TMPDIR: directory,
  }
  await $`git init --bare --initial-branch=main ${origin}`.env(env).quiet()
  const git = (...args: Parameters<typeof $>) => $(...args).cwd(repo).env(env)
  await git`git init --initial-branch=main`.quiet()
  await git`git config user.name ReleaseTest`.quiet()
  await git`git config user.email release-test@example.invalid`.quiet()
  await git`git config commit.gpgsign false`.quiet()
  await git`git config tag.gpgsign false`.quiet()
  await git`git remote add origin ${origin}`.quiet()
  await git`git add .`.quiet()
  await git`git commit -m initial`.quiet()
  await git`git push -u origin main`.quiet()
  const release = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "run", "release", ...args], {
      cwd: repo, env, stdout: "pipe", stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    return { stdout, stderr, code }
  }
  const calls = async (): Promise<string[][]> => (await Bun.file(log).text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  return { repo, origin, git, release, env, calls }
}

test.each([
  ["patch", "1.2.4"], ["minor", "1.3.0"], ["major", "2.0.0"],
])("release %s commits the version lifecycle and publishes ten assets after npm", async (bump, version) => {
  const t = await setup()
  const result = await t.release(...(bump === "patch" ? [] : [bump]))
  expect(result.code, result.stderr).toBe(0)
  const manifest = await Bun.file(join(t.repo, "package.json")).json()
  expect(manifest.version).toBe(version)
  expect(Object.values(manifest.optionalDependencies)).toEqual(Array(8).fill(version))
  const lock = await Bun.file(join(t.repo, "bun.lock")).json()
  expect(lock.workspaces[""].optionalDependencies).toEqual(manifest.optionalDependencies)
  for (const name of Object.keys(manifest.optionalDependencies)) expect(lock.packages[name][0]).toBe(`${name}@${version}`)
  const commit = (await t.git`git rev-parse HEAD`.text()).trim()
  expect((await t.git`git cat-file -t ${`v${version}`}`.text()).trim()).toBe("tag")
  expect((await t.git`git --git-dir=${t.origin} rev-parse refs/heads/main`.text()).trim()).toBe(commit)
  expect((await t.git`git --git-dir=${t.origin} rev-parse ${`refs/tags/v${version}^{}`}`.text()).trim()).toBe(commit)
  expect((await t.git`git show --format= --name-only HEAD`.text()).trim().split("\n")).toEqual(["bun.lock", "package.json"])
  expect((await t.git`git status --porcelain`.text()).trim()).toBe("")
  const calls = (await t.calls()).filter((args) => args[0] !== "auth")
  expect(calls.map((args) => args.slice(0, 2).join(" "))).toEqual([
    "repo view", "run list", "run watch", "run view", "run download", "release create",
  ])
  expect(calls[0]).toContain(t.origin)
  for (const [flag, value] of [["--workflow", "release.yml"], ["--event", "push"], ["--branch", `v${version}`], ["--commit", commit]]) {
    expect(calls[1][calls[1].indexOf(flag) + 1]).toBe(value)
  }
  expect(calls[2]).toContain("--exit-status")
  expect(calls[3].join(" ")).toContain("publish")
  expect(calls[4]).toContain("npm-packages")
  const download = calls[4][calls[4].indexOf("--dir") + 1]
  const create = calls[5]
  expect(create[2]).toBe(`v${version}`)
  expect(create).toContain("--verify-tag")
  expect(create).toContain("--generate-notes")
  const assets = create.filter((arg) => arg.endsWith(".tgz"))
  const names = [manifest.name, `${manifest.name}-native-source`, ...Object.keys(manifest.optionalDependencies)]
  expect(assets.map((file) => basename(file)).sort()).toEqual(names.map((name) => `${name.replace("@", "").replace("/", "-")}-${version}.tgz`).sort())
  expect(assets.every((file) => dirname(file) === download)).toBe(true)
  expect(existsSync(download)).toBe(false)
})

test.each([
  "unstaged package.json", "staged package.json", "index-only package.json",
  "unstaged bun.lock", "staged bun.lock", "index-only bun.lock",
  "branch", "behind", "diverged", "local tag", "remote tag", "multiple push URLs", "invalid bump",
  "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "unmerged",
])("release rejects %s without changing files, index, or release refs", async (state) => {
  const t = await setup()
  const initial = (await t.git`git rev-parse HEAD`.text()).trim()
  if (state.endsWith("package.json") || state.endsWith("bun.lock")) {
    const name = state.split(" ")[1]
    const file = Bun.file(join(t.repo, name))
    const original = await file.text()
    await Bun.write(file, original + "\n")
    if (!state.startsWith("unstaged")) await t.git`git add ${name}`.quiet()
    if (state.startsWith("index-only")) await Bun.write(file, original)
  }
  if (state === "branch") await t.git`git switch -c feature`.quiet()
  if (state === "behind" || state === "diverged") {
    await t.git`git commit --allow-empty -m remote-change`.quiet()
    await t.git`git push origin main`.quiet()
    await t.git`git update-ref refs/heads/main ${initial}`.quiet()
    if (state === "diverged") await t.git`git commit --allow-empty -m local-change`.quiet()
  }
  if (state.endsWith("tag")) await t.git`git tag v1.2.4`.quiet()
  if (state === "remote tag") {
    await t.git`git push origin refs/tags/v1.2.4`.quiet()
    await t.git`git tag -d v1.2.4`.quiet()
  }
  if (state === "multiple push URLs") {
    await t.git`git config --add remote.origin.pushurl ${t.origin}`.quiet()
    await t.git`git config --add remote.origin.pushurl ${join(t.repo, "missing.git")}`.quiet()
  }
  if (state.endsWith("_HEAD")) await Bun.write(join(t.repo, ".git", state), initial + "\n")
  if (state.startsWith("rebase-")) await mkdir(join(t.repo, ".git", state))
  if (state === "unmerged") {
    const blob = (await t.git`git rev-parse HEAD:tracked.txt`.text()).trim()
    const entries = `0 ${blob}\ttracked.txt\n100644 ${blob} 1\ttracked.txt\n100644 ${blob} 2\ttracked.txt\n100644 ${blob} 3\ttracked.txt\n`
    await t.git`printf ${entries} | git update-index --index-info`.quiet()
  }
  const before = await t.git`git status --porcelain`.text()
  const index = await t.git`git diff --cached`.text()
  const head = await t.git`git rev-parse HEAD`.text()
  const refs = await t.git`git --git-dir=${t.origin} show-ref`.text()
  const tags = await t.git`git tag --list`.text()
  const files = await Promise.all(["package.json", "bun.lock"].map((name) => Bun.file(join(t.repo, name)).text()))
  const result = await t.release(...(state === "invalid bump" ? ["nope"] : []))
  expect(result.code, result.stderr).toBe(1)
  expect(await t.git`git status --porcelain`.text()).toBe(before)
  expect(await t.git`git diff --cached`.text()).toBe(index)
  expect(await t.git`git rev-parse HEAD`.text()).toBe(head)
  expect(await t.git`git --git-dir=${t.origin} show-ref`.text()).toBe(refs)
  expect(await t.git`git tag --list`.text()).toBe(tags)
  expect(await Promise.all(["package.json", "bun.lock"].map((name) => Bun.file(join(t.repo, name)).text()))).toEqual(files)
  expect((await t.calls()).every((args) => args[0] === "auth" || args[0] === "repo")).toBe(true)
})

test.each(["1.2.3-beta.1", "1.2.3+build", "01.2.3"])("release requires a stable version, not %s", async (version) => {
  const t = await setup(version)
  const head = await t.git`git rev-parse HEAD`.text()
  const result = await t.release()
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("stable")
  expect(await t.git`git rev-parse HEAD`.text()).toBe(head)
  expect((await t.git`git status --porcelain`.text()).trim()).toBe("")
})

test.each([false, true])("release preserves unrelated staged, unstaged, and untracked changes (dry run: %s)", async (dryRun) => {
  const t = await setup()
  await Bun.write(join(t.repo, "tracked.txt"), "staged edit\n")
  await t.git`git add tracked.txt`.quiet()
  await Bun.write(join(t.repo, "tracked.txt"), "unstaged edit\n")
  await Bun.write(join(t.repo, "new.txt"), "untracked\n")
  const head = await t.git`git rev-parse HEAD`.text()
  const status = await t.git`git status --porcelain`.text()
  const staged = await t.git`git diff --cached`.text()
  const unstaged = await t.git`git diff`.text()
  const result = await t.release(...(dryRun ? ["minor", "--dry-run"] : []))
  expect(result.code, result.stderr).toBe(0)
  expect(await t.git`git status --porcelain`.text()).toBe(status)
  expect(await t.git`git diff --cached`.text()).toBe(staged)
  expect(await t.git`git diff`.text()).toBe(unstaged)
  expect(await Bun.file(join(t.repo, "new.txt")).text()).toBe("untracked\n")
  if (dryRun) {
    expect(result.stdout).toContain("Dry run: 1.2.3 -> 1.3.0")
    expect(await t.git`git rev-parse HEAD`.text()).toBe(head)
    expect(await t.git`git --git-dir=${t.origin} rev-parse refs/heads/main`.text()).toBe(head)
    expect((await t.git`git tag --list`.text()).trim()).toBe("")
    expect((await t.git`git --git-dir=${t.origin} tag --list`.text()).trim()).toBe("")
    expect((await t.calls()).filter((args) => args[0] !== "auth").map((args) => args.slice(0, 2))).toEqual([["repo", "view"]])
    expect(await t.git`git rev-parse FETCH_HEAD`.text()).toBe(head)
  } else {
    expect((await t.git`git show --format= --name-only HEAD`.text()).trim().split("\n")).toEqual(["bun.lock", "package.json"])
    expect(await t.git`git --git-dir=${t.origin} show v1.2.4:tracked.txt`.text()).toBe("initial\n")
    expect((await t.git`git --git-dir=${t.origin} ls-tree --name-only v1.2.4`.text()).split("\n")).not.toContain("new.txt")
  }
})

test.each(["follow tags", "tag refmap"])("release ignores Git push configuration for %s", async (config) => {
  const t = await setup()
  if (config === "follow tags") {
    await t.git`git tag -a v1.2.3 -m previous`.quiet()
    await t.git`git config push.followTags true`.quiet()
  } else {
    await t.git`git config remote.origin.push ${"refs/tags/*:refs/tags/archive/*"}`.quiet()
  }
  const result = await t.release("patch")
  expect(result.code, result.stderr).toBe(0)
  expect((await t.git`git --git-dir=${t.origin} tag --list`.text()).trim()).toBe("v1.2.4")
})

test.each(["push", "workflow", "failed publish", "skipped publish", "download", "missing artifact", "GitHub release"])(
  "release stops after %s failure and preserves the local commit and tag", async (failure) => {
    const t = await setup()
    const initial = (await t.git`git rev-parse HEAD`.text()).trim()
    if (failure === "push") {
      const hook = join(t.origin, "hooks", "update")
      await Bun.write(hook, '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1 ;; esac\nexit 0\n')
      await chmod(hook, 0o755)
    }
    if (failure === "workflow") t.env.RELEASE_TEST_FAIL_WATCH = "1"
    if (failure === "failed publish") t.env.RELEASE_TEST_PUBLISH = "failure"
    if (failure === "skipped publish") t.env.RELEASE_TEST_PUBLISH = "skipped"
    if (failure === "download") t.env.RELEASE_TEST_FAIL_DOWNLOAD = "1"
    if (failure === "missing artifact") t.env.RELEASE_TEST_MISSING_ARTIFACT = "1"
    if (failure === "GitHub release") t.env.RELEASE_TEST_FAIL_CREATE = "1"
    const result = await t.release()
    expect(result.code, result.stderr).toBe(1)
    const commit = (await t.git`git rev-parse HEAD`.text()).trim()
    expect(commit).not.toBe(initial)
    expect((await t.git`git rev-parse ${"v1.2.4^{}"}`.text()).trim()).toBe(commit)
    expect((await t.git`git --git-dir=${t.origin} rev-parse refs/heads/main`.text()).trim()).toBe(failure === "push" ? initial : commit)
    expect((await t.git`git --git-dir=${t.origin} tag --list`.text()).trim()).toBe(failure === "push" ? "" : "v1.2.4")
    expect((await t.git`git status --porcelain`.text()).trim()).toBe("")
    const calls = await t.calls()
    expect(calls.some((args) => args[0] === "release" && args[1] === "create")).toBe(failure === "GitHub release")
    const download = calls.find((args) => args[0] === "run" && args[1] === "download")
    if (download) expect(existsSync(download[download.indexOf("--dir") + 1])).toBe(false)
    if (["push", "workflow", "failed publish", "skipped publish"].includes(failure)) expect(download).toBeUndefined()
  },
)
