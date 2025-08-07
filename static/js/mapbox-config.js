
/**
 * Mapbox Configuration and Token Management
 */

// Global Mapbox token variable
window.MAPBOX_TOKEN = null;

/**
 * Initialize Mapbox token from API
 * @returns {Promise<boolean>} True if token loaded successfully
 */
async function initializeMapboxToken() {
    try {
        console.log('[MapboxConfig] Requesting Mapbox token from API...');
        
        const response = await fetch('/api/mapbox-token', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.success || !data.token) {
            throw new Error(data.error || 'No token received from API');
        }

        window.MAPBOX_TOKEN = data.token;
        console.log('[MapboxConfig] ✅ Mapbox token loaded successfully');
        return true;

    } catch (error) {
        console.error('[MapboxConfig] ❌ Failed to load Mapbox token:', error);
        return false;
    }
}

/**
 * Get the current Mapbox token
 * @returns {string|null} The current token or null if not loaded
 */
function getMapboxToken() {
    return window.MAPBOX_TOKEN;
}

/**
 * Check if Mapbox token is loaded
 * @returns {boolean} True if token is available
 */
function isMapboxTokenLoaded() {
    return !!window.MAPBOX_TOKEN;
}

// Make functions globally available
window.initializeMapboxToken = initializeMapboxToken;
window.getMapboxToken = getMapboxToken;
window.isMapboxTokenLoaded = isMapboxTokenLoaded;

console.log('[MapboxConfig] Mapbox configuration module loaded');
