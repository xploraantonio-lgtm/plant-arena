import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const SCAN_ROOTS = ['src/assets', 'public/game-assets']
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json', '.md'])
const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])
const SKIP_FILES = new Set(['public/favicon.png'])

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else files.push(full)
  }
  return files
}

const allRaster = []
for (const root of SCAN_ROOTS) {
  try {
    for (const file of await walk(path.join(ROOT, root))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (!SKIP_FILES.has(rel) && RASTER_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        allRaster.push(file)
      }
    }
  } catch {
    // Root may not exist in all checkouts.
  }
}

const conversions = []
let originalBytes = 0
let webpBytes = 0

for (const source of allRaster) {
  const ext = path.extname(source)
  const target = source.slice(0, -ext.length) + '.webp'
  const sourceStat = await fs.stat(source)
  originalBytes += sourceStat.size

  const tmp = `${target}.tmp`
  await sharp(source, { failOn: 'none' })
    .webp({ quality: 82, alphaQuality: 100, smartSubsample: true })
    .toFile(tmp)

  const targetStat = await fs.stat(tmp)
  if (targetStat.size >= sourceStat.size) {
    await fs.rm(tmp, { force: true })
    continue
  }

  await fs.rename(tmp, target)
  webpBytes += targetStat.size
  conversions.push({ source, target })
}

const repoFiles = await walk(ROOT)
const ignoredParts = new Set(['node_modules', '.git', 'dist', 'coverage'])
const textFiles = repoFiles.filter((file) => {
  const relParts = path.relative(ROOT, file).split(path.sep)
  return !relParts.some((part) => ignoredParts.has(part)) && TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
})

for (const file of textFiles) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    continue
  }
  let next = text

  for (const { source, target } of conversions) {
    const sourceRel = path.relative(ROOT, source).split(path.sep).join('/')
    const targetRel = path.relative(ROOT, target).split(path.sep).join('/')

    if (sourceRel.startsWith('public/game-assets/')) {
      const from = '/' + sourceRel.slice('public/'.length)
      const to = '/' + targetRel.slice('public/'.length)
      next = next.split(from).join(to)
    }

    if (sourceRel.startsWith('src/assets/')) {
      const fromRelative = path.relative(path.dirname(file), source).split(path.sep).join('/')
      const toRelative = path.relative(path.dirname(file), target).split(path.sep).join('/')
      const normalizedFrom = fromRelative.startsWith('.') ? fromRelative : './' + fromRelative
      const normalizedTo = toRelative.startsWith('.') ? toRelative : './' + toRelative
      next = next.split(normalizedFrom).join(normalizedTo)
    }
  }

  if (next !== text) await fs.writeFile(file, next, 'utf8')
}

const report = {
  converted: conversions.length,
  originalMB: Number((originalBytes / 1024 / 1024).toFixed(2)),
  webpMB: Number((webpBytes / 1024 / 1024).toFixed(2)),
  savedPercent: originalBytes ? Number(((1 - webpBytes / originalBytes) * 100).toFixed(1)) : 0,
}
await fs.writeFile('webp-optimization-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(report)
