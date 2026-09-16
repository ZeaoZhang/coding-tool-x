import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentSource = readFileSync(resolve(process.cwd(), 'src/components/RightPanel.vue'), 'utf8')
const styleSource = componentSource.slice(componentSource.indexOf('<style scoped>'))

function mediaRule(mediaQuery, selector) {
  const mediaStart = styleSource.indexOf(mediaQuery)
  const mediaEnd = styleSource.indexOf('</style>', mediaStart)
  const mediaSource = styleSource.slice(mediaStart, mediaEnd)
  const selectorStart = mediaSource.indexOf(selector)
  const selectorEnd = mediaSource.indexOf('}', selectorStart)
  return mediaSource.slice(selectorStart, selectorEnd)
}

describe('RightPanel short viewport layout', () => {
  it('keeps the channel area visible when the viewport is shorter than the log area', () => {
    const shortViewportPanel = mediaRule('@media (max-height: 600px)', '.right-panel')
    const shortViewportChannels = mediaRule('@media (max-height: 600px)', '.channels-section')
    const shortViewportLogs = mediaRule('@media (max-height: 600px)', '.logs-section')

    expect(shortViewportPanel).toContain('overflow-y: auto')
    expect(shortViewportChannels).toContain('flex: 0 0 360px')
    expect(shortViewportChannels).toContain('min-height: 360px')
    expect(shortViewportLogs).toContain('flex: 0 0 260px')
  })
})
