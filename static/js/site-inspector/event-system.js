
/**
 * Simplified Event System
 * Centralized event management with better error handling
 */

class SiteInspectorEventSystem {
    constructor() {
        this.listeners = new Map();
        this.eventHistory = [];
        this.maxHistorySize = 100;
    }
    
    on(eventName, callback, context = null) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        
        this.listeners.get(eventName).push({
            callback: context ? callback.bind(context) : callback,
            context
        });
    }
    
    off(eventName, callback) {
        if (!this.listeners.has(eventName)) return;
        
        const listeners = this.listeners.get(eventName);
        this.listeners.set(eventName, listeners.filter(listener => 
            listener.callback !== callback
        ));
    }
    
    emit(eventName, data = null) {
        // Record event for debugging
        this.recordEvent(eventName, data);
        
        if (!this.listeners.has(eventName)) return;
        
        const listeners = this.listeners.get(eventName);
        listeners.forEach(listener => {
            try {
                listener.callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${eventName}:`, error);
            }
        });
    }
    
    recordEvent(eventName, data) {
        this.eventHistory.push({
            name: eventName,
            data,
            timestamp: Date.now()
        });
        
        // Keep history size manageable
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }
    
    getEventHistory() {
        return [...this.eventHistory];
    }
    
    clearHistory() {
        this.eventHistory = [];
    }
}

// Replace the existing eventBus
window.eventBus = new SiteInspectorEventSystem();
