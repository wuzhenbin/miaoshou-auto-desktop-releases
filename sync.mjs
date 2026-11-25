import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repository = resolve(dirname(fileURLToPath(import.meta.url)))
const sourceRoot = resolve(process.env.MIAOSHOU_AUTO_SOURCE ?? join(repository, "../miaoshou-auto"), "dist/desktop")
const destinationRoot = join(repository, "dist")
const versionPattern = /^[a-f0-9]{64}$/
const releaseTagPattern = /^(?:sha256-)?[a-f0-9]{64}$/
const hashPattern = /^([a-f0-9]{64})  (.+)\r?$/
const reusable = ["runtime", "app/backend/node_modules"]
const fullArchive = "MiaoshouAuto-win-x64.tar.gz"
const appArchive = "MiaoshouAuto-win-x64-app.tar.gz"

function fail(message) {
    throw new Error(message)
}

async function digest(file) {
    const hash = createHash("sha256")
    const content = await readFile(file)
    hash.update(content)
    return hash.digest("hex")
}

async function collectFiles(root, current = "") {
    const result = []
    for (const entry of await readdir(join(root, current), { withFileTypes: true })) {
        const relative = join(current, entry.name).replaceAll("\\", "/")
        const path = join(root, relative)
        const details = await lstat(path)
        if (details.isSymbolicLink()) fail(`禁止同步符号链接：${relative}`)
        if (details.isDirectory()) result.push(...await collectFiles(root, relative))
        else if (details.isFile()) result.push(relative)
        else fail(`不支持的文件类型：${relative}`)
    }
    return result.sort()
}

async function verifyRelease(directory, version, { appOnly = false } = {}) {
    const manifestPath = join(directory, "release.sha256")
    const manifestHash = await digest(manifestPath)
    if (manifestHash !== version) fail(`release.sha256 摘要不匹配：${version}`)

    const lines = (await readFile(manifestPath, "utf8")).split(/\n/).filter(Boolean)
    const expected = new Map()
    for (const line of lines) {
        const match = line.match(hashPattern)
        if (!match) fail(`release.sha256 格式无效：${line}`)
        if (expected.has(match[2])) fail(`release.sha256 存在重复路径：${match[2]}`)
        if (appOnly && reusable.some(path => match[2].startsWith(path + "/"))) continue
        expected.set(match[2], match[1])
    }

    const actual = (await collectFiles(directory)).filter(path => path !== "release.sha256")
    const actualSet = new Set(actual)
    for (const path of actual) {
        const expectedHash = expected.get(path)
        if (!expectedHash) fail(`发布目录存在清单外文件：${path}`)
        if (await digest(join(directory, path)) !== expectedHash) fail(`发布文件摘要不匹配：${path}`)
    }
    for (const path of expected.keys()) if (!actualSet.has(path)) fail(`发布目录缺少文件：${path}`)
    return { fileCount: actual.length, manifestHash }
}

async function findVersions() {
    const entries = await readdir(join(sourceRoot, "releases"), { withFileTypes: true })
    const versions = await Promise.all(entries.filter(entry => entry.isDirectory() && versionPattern.test(entry.name)).map(async entry => ({
        name: entry.name,
        modifiedAt: (await stat(join(sourceRoot, "releases", entry.name))).mtimeMs,
    })))
    return versions.sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name)).map(version => version.name)
}

async function main() {
    const versions = await findVersions().catch(error => {
        if (error.code === "ENOENT") fail(`找不到桌面产物目录：${sourceRoot}`)
        throw error
    })
    if (!versions.length) fail(`桌面产物目录没有可同步的 SHA-256 版本：${sourceRoot}`)

    const requested = process.env.MIAOSHOU_AUTO_RELEASE
    if (requested && !versionPattern.test(requested)) fail("MIAOSHOU_AUTO_RELEASE 必须是 64 位小写 SHA-256")
    const version = requested ?? versions[0]
    if (!versions.includes(version)) fail(`找不到指定桌面版本：${version}`)

    const source = join(sourceRoot, "releases", version)
    const details = await verifyRelease(source, version)
    await mkdir(destinationRoot, { recursive: true })
    const work = await mkdtemp(join(destinationRoot, ".sync-"))
    const member = "releases/" + version
    try {
        for (const name of [fullArchive, appArchive]) {
            const appOnly = name === appArchive
            const archive = join(work, name)
            const options = appOnly ? reusable.map(path => "--exclude=" + member + "/" + path) : []
            const members = appOnly ? [member] : ["MiaoshouAuto.exe", "update.cmd", "rollback.cmd", member]
            execFileSync("tar", ["-czf", archive, ...options, "-C", sourceRoot, ...members], { stdio: "inherit" })
            const extracted = join(work, appOnly ? "app" : "full")
            await mkdir(extracted)
            execFileSync("tar", ["-xzf", archive, "-C", extracted], { stdio: "inherit" })
            await verifyRelease(join(extracted, member), version, { appOnly })
            await rm(extracted, { recursive: true })
        }
        for (const name of [fullArchive, appArchive]) await rename(join(work, name), join(destinationRoot, name))
    } finally { await rm(work, { recursive: true, force: true }) }
    await writeFile(join(destinationRoot, "version"), version + "\n")
    console.log("Windows 完整包和业务更新包已准备：" + destinationRoot + "，共 " + details.fileCount + " 个完整版本文件")
    if (process.argv.includes("--publish")) {
        const repo = "wuzhenbin/miaoshou-auto-desktop-releases"
        const tag = "sha256-" + version
        const gh = args => execFileSync("gh", [...args, "--repo", repo], { encoding: "utf8" })
        const list = () => JSON.parse(gh(["release", "list", "--limit", "1000", "--json", "tagName,isLatest,isDraft,isPrerelease"]))
        const attachments = [fullArchive, appArchive].map(name => join(destinationRoot, name))
        if (!list().some(item => item.tagName === tag && item.isLatest)) {
            gh(["release", "create", tag, ...attachments, "--target", "main", "--latest", "--title", "Windows x64 " + version.slice(0, 8), "--notes", "Windows x64 桌面客户端"])
        } else {
            const { assets } = JSON.parse(gh(["release", "view", tag, "--json", "assets"]))
            const missing = attachments.filter(path => !assets.some(asset => join(destinationRoot, asset.name) === path))
            if (missing.length) gh(["release", "upload", tag, ...missing])
        }
        const published = list()
        if (!published.some(item => item.tagName === tag && item.isLatest)) fail("最新 Release 校验失败")
        for (const item of published) {
            if (item.tagName !== tag && releaseTagPattern.test(item.tagName) && !item.isDraft && !item.isPrerelease)
                gh(["release", "delete", item.tagName, "--cleanup-tag", "--yes"])
        }
    }
}

main().catch(error => {
    console.error(`同步失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
})
