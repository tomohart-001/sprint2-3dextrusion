
/**
 * Essential Mapbox Configuration
 */

// Mapbox access token (will be fetched from backend)
let MAPBOX_TOKEN = null;

// Default map configuration
const MAP_CONFIG = {
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [174.7633, -36.8485], // Auckland, NZ [longitude, latitude]
    zoom: 13,
    pitch: 0,
    bearing: 0,
    antialias: true
};

// Initialize Mapbox token with retry
async function initializeMapboxToken(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[MapboxConfig] Requesting Mapbox token... (attempt ${attempt}/${retries})`);
            const response = await fetch('/api/mapbox-token');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('[MapboxConfig] Token response:', { success: data.success, hasToken: !!data.token });
            
            if (data.success && data.token) {
                MAPBOX_TOKEN = data.token;
                window.MAPBOX_TOKEN = data.token; // Also expose on window
                
                // Check if mapboxgl is available
                if (typeof mapboxgl !== 'undefined') {
                    mapboxgl.accessToken = MAPBOX_TOKEN;
                    console.log('[MapboxConfig] Token loaded and set successfully');
                } else {
                    console.warn('[MapboxConfig] mapboxgl not available, token stored for later use');
                }
                return true;
            } else {
                console.error('[MapboxConfig] Failed to get Mapbox token:', data.error);
                if (attempt === retries) return false;
            }
        } catch (error) {
            console.error(`[MapboxConfig] Error fetching Mapbox token (attempt ${attempt}):`, error);
            if (attempt === retries) return false;
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return false;
}

// Export configuration
window.MAP_CONFIG = MAP_CONFIG;
window.initializeMapboxToken = initializeMapboxToken;

console.log('[MapboxConfig] Configuration loaded');
