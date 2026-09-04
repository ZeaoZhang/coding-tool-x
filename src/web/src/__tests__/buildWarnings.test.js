import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = process.cwd()
const viteBin = resolve(webRoot, 'node_modules/vite/bin/vite.js')

function runProductionBuild(outputDir) {
  const result = spawnSync(process.execPath, [viteBin, 'build', '--outDir', outputDir], {
    cwd: webRoot,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    encoding: 'utf8',
    stdio: 'pipe'
  })
  const output = `${result.stdout}\n${result.stderr}`

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(output)
  }

  return output
}

function getInitialJavaScriptAssets(outputDir) {
  const html = readFileSync(resolve(outputDir, 'index.html'), 'utf8')
  const modulePreloads = [...html.matchAll(/<link rel="modulepreload"[^>]+href="([^"]+)"/g)]
    .map(([, assetPath]) => assetPath)
  const entryScripts = [...html.matchAll(/<script type="module"[^>]+src="([^"]+)"/g)]
    .map(([, assetPath]) => assetPath)

  return [...new Set([...modulePreloads, ...entryScripts])]
}

function getInitialJavaScriptBytes(outputDir, assetPaths) {
  return assetPaths
    .filter(assetPath => assetPath.endsWith('.js'))
    .reduce((total, assetPath) => {
      const fileName = assetPath.split('/').pop()
      const filePath = resolve(outputDir, 'assets', fileName)
      return total + statSync(filePath).size
    }, 0)
}

describe('production web build', () => {
  it('does not emit Vite configuration or invalid CSS selector warnings', () => {
    const outputDir = mkdtempSync(resolve(tmpdir(), 'coding-tool-x-web-build-'))

    try {
      const output = runProductionBuild(outputDir)

      expect(output).toContain('built')
      expect(output).not.toContain('uses features that are unsupported by `configLoader: \'native\'`')
      expect(output).not.toContain("'deep' is not recognized as a valid pseudo-class")
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('does not preload hidden drawer and route code on the initial page', () => {
    const outputDir = mkdtempSync(resolve(tmpdir(), 'coding-tool-x-web-build-'))

    try {
      runProductionBuild(outputDir)
      const initialAssets = getInitialJavaScriptAssets(outputDir)

      expect(initialAssets.some(assetPath => /(?:Analytics|ChatHistoryDrawer|RightPanel|SettingsDrawer|markdown)-/.test(assetPath))).toBe(false)
      expect(getInitialJavaScriptBytes(outputDir, initialAssets)).toBeLessThan(1_000_000)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  }, 15_000)
})
