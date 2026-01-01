import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkForUpdates } from './updater'

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear console spies
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  describe('checkForUpdates', () => {
    it('should log message when running in Electron', async () => {
      // Mock Electron environment
      Object.defineProperty(window, 'electron', {
        value: { getVersion: () => '1.0.0' },
        writable: true,
        configurable: true,
      })

      await checkForUpdates()

      expect(console.log).toHaveBeenCalledWith(
        'Running in Electron - auto-updates will be handled by electron-updater'
      )

      // Cleanup
      delete (window as { electron?: unknown }).electron
    })

    it('should log message when not running in Electron', async () => {
      await checkForUpdates()

      expect(console.log).toHaveBeenCalledWith(
        'Not running in Electron - skipping update check'
      )
    })
  })
})
