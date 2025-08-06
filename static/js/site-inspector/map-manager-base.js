
/**
 * Map Manager Base
 * Base class for managers that work with map layers and sources
 */

class MapManagerBase extends BaseManager {
    constructor(name, map) {
        super(name);
        this.map = map;
        this.sources = new Map();
        this.layers = new Map();
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
            if (this.map.isStyleLoaded()) {
                resolve();
                return;
            }
            
            const checkStyle = () => {
                if (this.map.isStyleLoaded()) {
                    resolve();
                } else {
                    requestAnimationFrame(checkStyle);
                }
            };
            
            checkStyle();
        });
    }

    // Source management
    addSource(id, sourceData, replace = false) {
        try {
            if (this.map.getSource(id) && !replace) {
                this.debug(`Source ${id} already exists`);
                return;
            }

            if (this.map.getSource(id) && replace) {
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
            // Remove all layers using this source first
            this.layers.forEach((layerData, layerId) => {
                if (layerData.source === id) {
                    this.removeLayer(layerId);
                }
            });

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
            if (source && source.setData) {
                source.setData(data);
                this.debug(`Updated source: ${id}`);
            } else {
                this.warn(`Source ${id} not found or not updateable`);
            }
        } catch (error) {
            this.error(`Failed to update source ${id}:`, error);
        }
    }

    // Layer management
    addLayer(layerData, beforeId = null) {
        try {
            const { id } = layerData;
            
            if (this.map.getLayer(id)) {
                this.debug(`Layer ${id} already exists`);
                return;
            }

            this.map.addLayer(layerData, beforeId);
            this.layers.set(id, layerData);
            this.debug(`Added layer: ${id}`);
            
        } catch (error) {
            this.error(`Failed to add layer ${layerData.id}:`, error);
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

    // Geometry utilities
    calculateDistance(lng1, lat1, lng2, lat2) {
        const R = 6371000; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    calculatePolygonArea(coordinates) {
        if (!this.validateCoordinates(coordinates)) return 0;
        
        try {
            if (typeof turf !== 'undefined') {
                const polygon = turf.polygon([coordinates]);
                return turf.area(polygon);
            } else {
                return this.calculatePolygonAreaFallback(coordinates);
            }
        } catch (error) {
            this.warn('Error calculating area with Turf.js, using fallback:', error);
            return this.calculatePolygonAreaFallback(coordinates);
        }
    }

    calculatePolygonAreaFallback(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;

        let area = 0;
        const n = coordinates.length;

        for (let i = 0; i < n - 1; i++) {
            const j = (i + 1) % (n - 1);
            area += coordinates[i][0] * coordinates[j][1];
            area -= coordinates[j][0] * coordinates[i][1];
        }

        return Math.abs(area) / 2;
    }

    // Cleanup
    destroy() {
        // Remove all layers and sources
        this.layers.forEach((_, layerId) => this.removeLayer(layerId));
        this.sources.forEach((_, sourceId) => this.removeSource(sourceId));
        
        super.destroy();
    }
}

// Make globally available
window.MapManagerBase = MapManagerBase;
