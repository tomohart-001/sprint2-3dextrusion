/**
 * Site Inspector Configuration
 * Centralized configuration for all site inspector components
 */
class SiteInspectorConfig {
    constructor() {
        this.config = {
            map: {
                defaultZoom: 16,
                maxZoom: 22,
                minZoom: 8
            },
            drawing: {
                strokeWidth: 3,
                fillOpacity: 0.3,
                strokeColor: '#ff6b35'
            },
            features: {
                debug: false,
                dimensions: true,
                measurements: true
            }
        };
    }

    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.config);
    }

    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, this.config);
        target[lastKey] = value;
    }

    loadEnvironmentConfig() {
        // Load any environment-specific configurations
        if (window.DEBUG_MODE) {
            this.set('features.debug', true);
        }
    }
}

// Global configuration instance
window.SiteInspectorConfig = new SiteInspectorConfig();
window.SiteInspectorConfig.loadEnvironmentConfig();

// Debug mode
window.DEBUG_MODE = window.SiteInspectorConfig.get('features.debug');