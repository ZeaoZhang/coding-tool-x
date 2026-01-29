const { EventEmitter } = require('events');

class PluginEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Emit event synchronously with error isolation
   * All listener errors are caught and logged, not propagated
   * @param {string} event - Event name
   * @param {*} payload - Event payload
   */
  emitSync(event, payload) {
    const listeners = this.listeners(event);
    
    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(
          `[PluginEventBus] Error in listener for event "${event}":`,
          error.message
        );
      }
    });
  }

  /**
   * Emit event asynchronously with error isolation
   * Listeners are awaited sequentially; errors are caught and logged
   * @param {string} event - Event name
   * @param {*} payload - Event payload
   * @returns {Promise<void>}
   */
  async emitAsync(event, payload) {
    const listeners = this.listeners(event);
    
    for (const listener of listeners) {
      try {
        await listener(payload);
      } catch (error) {
        console.error(
          `[PluginEventBus] Error in async listener for event "${event}":`,
          error.message
        );
      }
    }
  }
}

// Export singleton instance
module.exports = new PluginEventBus();
