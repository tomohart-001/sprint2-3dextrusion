
/**
 * Enhanced Base Manager
 * Provides common functionality for all Site Inspector managers
 */

class BaseManager {
    constructor(name) {
        this.name = name;
        this.isInitialized = false;
        this.eventHandlers = new Map();
        this.cleanup = [];
        this.retryCount = 0;
        this.maxRetries = 3;
    }

    // Logging methods
    info(...args) {
        console.log(`[${this.name}] INFO:`, ...args);
    }

    warn(...args) {
        console.warn(`[${this.name}] WARN:`, ...args);
    }

    error(...args) {
        console.error(`[${this.name}] ERROR:`, ...args);
    }

    debug(...args) {
        if (window.DEBUG_MODE) {
            console.debug(`[${this.name}] DEBUG:`, ...args);
        }
    }

    // Event handling
    on(eventName, handler, context = null) {
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, []);
        }
        
        const boundHandler = context ? handler.bind(context) : handler;
        this.eventHandlers.get(eventName).push(boundHandler);
        
        // Register with global event bus
        if (window.eventBus) {
            window.eventBus.on(eventName, boundHandler);
        }
        
        // Track for cleanup
        this.cleanup.push(() => {
            if (window.eventBus) {
                window.eventBus.off(eventName, boundHandler);
            }
        });
    }

    emit(eventName, data = null) {
        // Emit to local handlers
        if (this.eventHandlers.has(eventName)) {
            this.eventHandlers.get(eventName).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.error(`Error in local event handler for ${eventName}:`, error);
                }
            });
        }

        // Emit to global event bus
        if (window.eventBus) {
            window.eventBus.emit(eventName, data);
        }
    }

    // DOM utilities
    getElementById(id, required = true) {
        const element = document.getElementById(id);
        if (required && !element) {
            this.warn(`Required element with ID '${id}' not found`);
        }
        return element;
    }

    setElementDisplay(id, display = 'block') {
        const element = this.getElementById(id, false);
        if (element) element.style.display = display;
    }

    setElementText(id, text) {
        const element = this.getElementById(id, false);
        if (element) element.textContent = text;
    }

    toggleElementClass(id, className, add = true) {
        const element = this.getElementById(id, false);
        if (element) {
            element.classList.toggle(className, add);
        }
    }

    // Async utilities with retry
    async withRetry(operation, context = 'operation') {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (attempt === this.maxRetries) {
                    this.error(`${context} failed after ${this.maxRetries} attempts:`, error);
                    throw error;
                }
                
                this.warn(`${context} attempt ${attempt} failed, retrying:`, error.message);
                await this.delay(1000 * attempt);
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Validation helpers
    validateRequired(obj, fields, context = 'validation') {
        const missing = fields.filter(field => !obj || obj[field] === undefined || obj[field] === null);
        if (missing.length > 0) {
            throw new Error(`${context} failed: missing required fields: ${missing.join(', ')}`);
        }
    }

    validateCoordinates(coordinates) {
        return coordinates && 
               Array.isArray(coordinates) && 
               coordinates.length >= 3 &&
               coordinates.every(coord => 
                   Array.isArray(coord) && 
                   coord.length >= 2 && 
                   typeof coord[0] === 'number' && 
                   typeof coord[1] === 'number'
               );
    }

    // Status management
    showStatus(elementId, message, type = 'info', duration = 5000) {
        const element = this.getElementById(elementId, false);
        if (!element) return;

        element.textContent = message;
        element.className = `status ${type}`;
        element.style.display = 'block';

        if (duration > 0) {
            setTimeout(() => {
                element.style.display = 'none';
            }, duration);
        }
    }

    // Initialization framework
    async initialize() {
        if (this.isInitialized) {
            this.warn('Manager already initialized');
            return;
        }

        try {
            this.info('Initializing...');
            
            // Validate dependencies
            await this.validateDependencies();
            
            // Setup phase
            await this.setup();
            
            // Register event listeners
            await this.registerEventListeners();
            
            // Post-initialization
            await this.postInitialize();
            
            this.isInitialized = true;
            this.info('✅ Initialized successfully');
            
        } catch (error) {
            this.error('❌ Initialization failed:', error);
            throw error;
        }
    }

    // Override these in subclasses
    async validateDependencies() {
        // Override in subclasses
    }

    async setup() {
        // Override in subclasses
    }

    async registerEventListeners() {
        // Override in subclasses
    }

    async postInitialize() {
        // Override in subclasses
    }

    // Cleanup
    destroy() {
        this.info('Cleaning up...');
        
        // Run cleanup functions
        this.cleanup.forEach(cleanupFn => {
            try {
                cleanupFn();
            } catch (error) {
                this.error('Error during cleanup:', error);
            }
        });
        
        this.cleanup = [];
        this.eventHandlers.clear();
        this.isInitialized = false;
        
        this.info('Cleanup completed');
    }
}

// Make globally available
window.BaseManager = BaseManager;
