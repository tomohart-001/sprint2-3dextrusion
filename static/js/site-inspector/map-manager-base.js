/**
 * Map Manager Base
 * Base class for managers that work with map layers and sources
 */

// Ensure BaseManager is available or provide fallback
if (typeof BaseManager === 'undefined') {
    console.warn('[MapManagerBase] BaseManager not available, using fallback');
    window.BaseManager = class {
        constructor(name) { this.name = name; }
        info(...args)  { console.log(`[${this.name}] INFO:`, ...args); }
        warn(...args)  { console.warn(`[${this.name}] WARN:`, ...args); }
        error(...args) { console.error(`[${this.name}] ERROR:`, ...args); }
        debug(...args) { console.debug?.(`[${this.name}] DEBUG:`, ...args); }
        // Optional destroy in fallback to avoid errors
        destroy() {}
    };
}

class MapManagerBase extends BaseManager {
    constructor(name, map) {
        super(name);
        this.map = map;
        this.sources = new Map(); // id -> source init data
        this.layers = new Map();  // id -> layer init data
    }

    async validateDependencies() {
        if (!this.map) {
            throw new Error('Map instance required');
        }
        if (!this.map.isStyleLoaded()) {
            this.warn('Map style not loaded, waiting...');
            await this.waitForMapStyle();
        }
    }

    waitForMapStyle() {
        return new Promise((resolve) => {
            if (this.map?.isStyleLoaded?.()) return resolve();
            const checkStyle = () => {
                if (this.map?.isStyleLoaded?.()) resolve();
                else requestAnimationFrame(checkStyle);
            };
            checkStyle();
        });
    }

    /* -----------------------------
       Source management
    ------------------------------ */
    addSource(id, sourceData, replace = false) {
        try {
            if (this.map.getSource(id)) {
                if (!replace) {
                    this.debug(`Source ${id} already exists`);
                    return;
                }
                this.removeSource(id);
            }
            this.map.addSource(id, sourceData);
            this.sources.set(id, sourceData);
            this.debug(`Added source: ${id}`);
        } catch (error) {
            this.error(`Failed to add source ${id}:`, error);
            throw error;
        }
    }

    removeSource(id) {
        try {
            // Remove layers that use this source first
            for (const [layerId, layerData] of Array.from(this.layers.entries())) {
                if (layerData.source === id) this.removeLayer(layerId);
            }
            if (this.map.getSource(id)) {
                this.map.removeSource(id);
                this.sources.delete(id);
                this.debug(`Removed source: ${id}`);
            }
        } catch (error) {
            this.error(`Failed to remove source ${id}:`, error);
        }
    }

    updateSource(id, data) {
        try {
            const source = this.map.getSource(id);
            if (source?.setData) {
                source.setData(data);
                this.debug(`Updated source: ${id}`);
            } else {
                this.warn(`Source ${id} not found or not updateable`);
            }
        } catch (error) {
            this.error(`Failed to update source ${id}:`, error);
        }
    }

    /* -----------------------------
       Layer management
    ------------------------------ */
    addLayer(layerData, beforeId = null) {
        try {
            const { id } = layerData;
            if (!id) throw new Error('Layer data must include an id');
            if (this.map.getLayer(id)) {
                this.debug(`Layer ${id} already exists`);
                return;
            }
            this.map.addLayer(layerData, beforeId || undefined);
            this.layers.set(id, layerData);
            this.debug(`Added layer: ${id}`);
        } catch (error) {
            this.error(`Failed to add layer ${layerData?.id ?? '(no id)'}:`, error);
            throw error;
        }
    }

    removeLayer(id) {
        try {
            if (this.map.getLayer(id)) {
                this.map.removeLayer(id);
                this.layers.delete(id);
                this.debug(`Removed layer: ${id}`);
            }
        } catch (error) {
            this.error(`Failed to remove layer ${id}:`, error);
        }
    }

    setLayerVisibility(id, visible) {
        try {
            if (this.map.getLayer(id)) {
                this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
                this.debug(`Set layer ${id} visibility: ${visible}`);
            }
        } catch (error) {
            this.error(`Failed to set layer ${id} visibility:`, error);
        }
    }

    /* -----------------------------
       Geometry utilities
    ------------------------------ */
    calculateDistance(lng1, lat1, lng2, lat2) {
        const R = 6371000; // meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) ** 2 +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    calculatePolygonArea(coordinates) {
        if (!this.validateCoordinates(coordinates)) return 0;

        try {
            const turf = window?.turf;
            if (turf?.area && turf?.polygon) {
                // turf expects an array of rings: [ring]
                const polygon = turf.polygon([coordinates]);
                const area = turf.area(polygon);
                return Number.isFinite(area) ? area : 0;
            }
        } catch (error) {
            this.warn('Error calculating area with Turf.js, using fallback:', error);
        }
        return this.calculatePolygonAreaFallback(coordinates);
    }

    calculatePolygonAreaFallback(coordinates) {
        // Shoelace in degrees → convert to meters using local scale
        if (!coordinates || coordinates.length < 3) return 0;

        // ensure ring is closed
        const ring = coordinates.slice();
        const [fx, fy] = ring[0];
        const [lx, ly] = ring[ring.length - 1];
        if (fx !== lx || fy !== ly) ring.push([fx, fy]);

        let degArea = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            const [x1, y1] = ring[i];
            const [x2, y2] = ring[i + 1];
            degArea += x1 * y2 - x2 * y1;
        }
        degArea = Math.abs(degArea) / 2;

        // crude conversion to m² based on latitude
        const lat = ring[0]?.[1] ?? 0;
        const mPerDegX = 111320 * Math.cos(lat * Math.PI / 180);
        const mPerDegY = 110540;
        return degArea * mPerDegX * mPerDegY;
    }

    validateCoordinates(coords) {
        if (!Array.isArray(coords) || coords.length < 3) return false;
        for (const c of coords) {
            if (!Array.isArray(c) || c.length < 2) return false;
            const [lng, lat] = c;
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
            if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return false;
        }
        return true;
    }

    /* -----------------------------
       Cleanup
    ------------------------------ */
    destroy() {
        try {
            // Remove layers first (copy keys to avoid mutation during iteration)
            for (const id of Array.from(this.layers.keys())) {
                this.removeLayer(id);
            }
            // Then remove sources
            for (const id of Array.from(this.sources.keys())) {
                this.removeSource(id);
            }

            // Call BaseManager.destroy if it exists
            if (typeof BaseManager?.prototype?.destroy === 'function') {
                BaseManager.prototype.destroy.call(this);
            }
            this.debug('MapManagerBase destroyed');
        } catch (e) {
            this.error('Error during MapManagerBase destroy:', e);
        }
    }
}

// Make globally available
window.MapManagerBase = MapManagerBase;