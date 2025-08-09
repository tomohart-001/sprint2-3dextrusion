
/**
 * Extrusion 3D Manager
 * Handles 3D building extrusion functionality
 */

class Extrusion3DManager extends BaseManager {
    constructor(map) {
        super('Extrusion3DManager');
        this.map = map;
        this.activeExtrusions = new Map();
        this.defaultHeight = 9; // meters
        this.is3DViewEnabled = false;
    }

    async initialize() {
        try {
            this.info('Initializing 3D Extrusion Manager...');
            
            // Verify map is available
            if (!this.map) {
                throw new Error('Map instance required for 3D extrusions');
            }

            // Setup UI event listeners
            this.setupUIEventListeners();
            
            // Setup event listeners for clearing
            this.setupEventListeners();

            this.info('✅ Extrusion3DManager initialized successfully');
            return true;
        } catch (error) {
            this.error('Failed to initialize Extrusion3DManager:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Listen for site boundary deletion to clear all extrusions
        window.eventBus.on('site-boundary-deleted', () => {
            this.info('Site boundary deleted - clearing all 3D extrusions');
            this.removeAllExtrusions();
        });

        // Listen for comprehensive clearing
        window.eventBus.on('clear-all-dependent-features', () => {
            this.info('Comprehensive clearing - removing all 3D extrusions');
            this.removeAllExtrusions();
        });

        // Listen for comprehensive site data clearing
        window.eventBus.on('clear-all-site-data', () => {
            this.info('Complete site data clearing requested - removing all 3D extrusions');
            this.removeAllExtrusions();
        });
    }

    setupUIEventListeners() {
        // Structure extrusion button (primary action)
        const extrudeStructureButton = document.getElementById('extrudeStructureButton');
        if (extrudeStructureButton) {
            extrudeStructureButton.addEventListener('click', () => {
                try {
                    this.extrudeStructureFootprint();
                } catch (error) {
                    this.error('Structure extrusion failed:', error);
                    alert('Failed to extrude structure: ' + error.message);
                }
            });
        }

        

        // 3D view toggle button
        const toggle3DViewButton = document.getElementById('toggle3DViewButton');
        if (toggle3DViewButton) {
            toggle3DViewButton.addEventListener('click', () => this.toggle3DView());
        }

        // Remove all 3D models button
        const removeAll3DBtn = document.getElementById('removeAll3DBtn');
        if (removeAll3DBtn) {
            removeAll3DBtn.addEventListener('click', () => this.removeAllExtrusions());
        }

        this.info('UI event listeners setup completed');
    }

    clearAllExtrusions() {
        try {
            this.info('Clearing all 3D extrusions...');
            
            // Clear all structure extrusions
            this.activeExtrusions.forEach((extrusion, id) => {
                if (this.map.getLayer(id)) {
                    this.map.removeLayer(id);
                }
                if (this.map.getSource(id)) {
                    this.map.removeSource(id);
                }
            });
            
            // Clear active extrusions tracking
            this.activeExtrusions.clear();
            
            // Reset map view
            this.map.easeTo({
                pitch: 0,
                bearing: 0,
                duration: 1000
            });
            
            // Update UI
            this.updateActiveExtrusionsDisplay();
            
            this.info('All 3D extrusions cleared');
        } catch (error) {
            this.error('Error clearing all extrusions:', error);
        }
    }

    

    extrudeStructureFootprint() {
        try {
            // Get height from structure height input first, then fallback to property setbacks
            const heightInput = document.getElementById('structureHeightInput');
            let height = parseFloat(heightInput?.value) || 12; // Default fallback
            
            // If no structure height specified, try property setbacks height limit
            if (!heightInput?.value) {
                const propertySetbacksManager = window.siteInspectorCore?.propertySetbacksManager;
                if (propertySetbacksManager) {
                    const heightLimit = propertySetbacksManager.getCurrentHeightLimit();
                    if (heightLimit && heightLimit > 0) {
                        height = heightLimit;
                    }
                }
            }

            // Get structure footprint from floorplan manager
            const floorplanManager = window.siteInspectorCore?.floorplanManager;
            if (!floorplanManager) {
                throw new Error('Floorplan manager not available');
            }

            // Try multiple methods to get structure coordinates
            let structureCoords = null;
            
            // Method 1: getCurrentFloorplanCoordinates
            structureCoords = floorplanManager.getCurrentFloorplanCoordinates();
            
            // Method 2: Check if there's a current structure
            if (!structureCoords && floorplanManager.currentStructure) {
                const geometry = floorplanManager.currentStructure.geometry;
                if (geometry && geometry.coordinates && geometry.coordinates[0]) {
                    structureCoords = geometry.coordinates[0];
                }
            }
            
            // Method 3: Check state for geojson polygon
            if (!structureCoords && floorplanManager.state?.geojsonPolygon) {
                const geometry = floorplanManager.state.geojsonPolygon.geometry;
                if (geometry && geometry.coordinates && geometry.coordinates[0]) {
                    structureCoords = geometry.coordinates[0];
                }
            }

            if (!structureCoords || structureCoords.length === 0) {
                throw new Error('No structure footprint available. Please draw a structure first using the Floor Plan tools.');
            }

            // Ensure coordinates are in [lng, lat] format
            const coordinates = structureCoords.map(coord => {
                if (Array.isArray(coord) && coord.length >= 2) {
                    return [coord[0], coord[1]];
                }
                return coord;
            });

            const extrusionId = this.extrudePolygon(coordinates, height, {
                color: '#ff6b35',
                opacity: 0.9,
                type: 'structure'
            });

            this.showExtrusionStatus(`3D structure created (${height}m height)`, 'success');
            this.updateActiveExtrusionsDisplay();

            // Emit event
            window.eventBus?.emit('extrusion-applied', {
                type: 'structure',
                height: height,
                extrusionId: extrusionId,
                coordinates: coordinates
            });

            return extrusionId;

        } catch (error) {
            this.error('Failed to extrude structure footprint:', error);
            this.showExtrusionStatus(`Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Extrude a polygon to create 3D building
     */
    extrudePolygon(polygonCoords, height = this.defaultHeight, properties = {}) {
        try {
            if (!polygonCoords || polygonCoords.length < 3) {
                throw new Error('Invalid polygon coordinates for extrusion');
            }

            const extrusionId = `extrusion_${Date.now()}`;
            
            // Ensure coordinates form closed polygon
            const coords = [...polygonCoords];
            const firstCoord = coords[0];
            const lastCoord = coords[coords.length - 1];
            if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                coords.push([...firstCoord]);
            }

            const extrusionData = {
                type: 'Feature',
                id: extrusionId,
                geometry: {
                    type: 'Polygon',
                    coordinates: [coords]
                },
                properties: {
                    height: height,
                    base: 0,
                    color: properties.color || '#8B4513',
                    opacity: properties.opacity || 0.8,
                    extrusionType: properties.type || 'generic',
                    ...properties
                }
            };

            // Add source if it doesn't exist
            if (!this.map.getSource('building-extrusions')) {
                this.map.addSource('building-extrusions', {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: []
                    }
                });
            }

            // Add layer if it doesn't exist
            if (!this.map.getLayer('building-extrusion-layer')) {
                this.map.addLayer({
                    id: 'building-extrusion-layer',
                    type: 'fill-extrusion',
                    source: 'building-extrusions',
                    paint: {
                        'fill-extrusion-color': ['get', 'color'],
                        'fill-extrusion-height': ['get', 'height'],
                        'fill-extrusion-base': ['get', 'base'],
                        'fill-extrusion-opacity': ['get', 'opacity']
                    }
                });
            }

            // Add extrusion to active list
            this.activeExtrusions.set(extrusionId, extrusionData);

            // Update map source
            this.updateExtrusionsSource();

            this.info(`Created 3D extrusion: ${extrusionId} with height ${height}m`);
            return extrusionId;

        } catch (error) {
            this.error('Failed to create extrusion:', error);
            throw error;
        }
    }

    /**
     * Remove specific extrusion
     */
    removeExtrusion(extrusionId) {
        try {
            if (this.activeExtrusions.has(extrusionId)) {
                this.activeExtrusions.delete(extrusionId);
                this.updateExtrusionsSource();
                this.updateActiveExtrusionsDisplay();
                this.info(`Removed extrusion: ${extrusionId}`);
                return true;
            }
            return false;
        } catch (error) {
            this.error('Failed to remove extrusion:', error);
            return false;
        }
    }

    /**
     * Remove all extrusions
     */
    removeAllExtrusions() {
        try {
            this.activeExtrusions.clear();
            this.updateExtrusionsSource();
            this.updateActiveExtrusionsDisplay();
            this.showExtrusionStatus('All 3D models removed', 'info');
            this.info('Removed all extrusions');
            return true;
        } catch (error) {
            this.error('Failed to remove all extrusions:', error);
            return false;
        }
    }

    /**
     * Update extrusion height
     */
    updateExtrusionHeight(extrusionId, newHeight) {
        try {
            if (this.activeExtrusions.has(extrusionId)) {
                const extrusion = this.activeExtrusions.get(extrusionId);
                extrusion.properties.height = newHeight;
                this.updateExtrusionsSource();
                this.updateActiveExtrusionsDisplay();
                this.info(`Updated extrusion ${extrusionId} height to ${newHeight}m`);
                return true;
            }
            return false;
        } catch (error) {
            this.error('Failed to update extrusion height:', error);
            return false;
        }
    }

    /**
     * Update map source with current extrusions
     */
    updateExtrusionsSource() {
        try {
            const source = this.map.getSource('building-extrusions');
            if (source) {
                const features = Array.from(this.activeExtrusions.values());
                source.setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
        } catch (error) {
            this.error('Failed to update extrusions source:', error);
        }
    }

    /**
     * Update active extrusions display in UI
     */
    updateActiveExtrusionsDisplay() {
        const activeExtrusionsDisplay = document.getElementById('activeExtrusionsDisplay');
        const extrusionsList = document.getElementById('extrusionsList');
        const removeAll3DBtn = document.getElementById('removeAll3DBtn');

        if (!activeExtrusionsDisplay || !extrusionsList) return;

        const hasExtrusions = this.activeExtrusions.size > 0;

        if (hasExtrusions) {
            activeExtrusionsDisplay.style.display = 'block';
            if (removeAll3DBtn) removeAll3DBtn.style.display = 'block';

            // Build extrusions list
            const extrusionsArray = Array.from(this.activeExtrusions.entries());
            extrusionsList.innerHTML = extrusionsArray.map(([id, data]) => {
                const type = data.properties.extrusionType || 'generic';
                const height = data.properties.height || 0;
                const typeLabel = type === 'buildable_area' ? 'Buildable Area' : 
                                type === 'structure' ? 'Structure' : 'Building';
                
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                        <span>${typeLabel}: ${height}m</span>
                        <button onclick="window.siteInspectorCore?.extrusion3DManager?.removeExtrusion('${id}')" 
                                style="background: #dc3545; color: white; border: none; padding: 2px 6px; border-radius: 4px; font-size: 10px;">
                            Remove
                        </button>
                    </div>
                `;
            }).join('');
        } else {
            activeExtrusionsDisplay.style.display = 'none';
            if (removeAll3DBtn) removeAll3DBtn.style.display = 'none';
        }
    }

    /**
     * Check if there are active extrusions
     */
    hasActiveExtrusions() {
        return this.activeExtrusions.size > 0;
    }

    /**
     * Get all active extrusions
     */
    getActiveExtrusions() {
        return Array.from(this.activeExtrusions.entries()).map(([id, data]) => ({
            id,
            ...data
        }));
    }

    /**
     * Toggle 3D view
     */
    toggle3DView() {
        try {
            const button = document.getElementById('toggle3DViewButton');
            
            if (this.is3DViewEnabled) {
                // Disable 3D view
                this.map.easeTo({
                    pitch: 0,
                    bearing: 0,
                    duration: 1000
                });
                this.is3DViewEnabled = false;
                if (button) button.textContent = 'Enable 3D View';
                this.info('3D view disabled');
            } else {
                // Enable 3D view
                this.map.easeTo({
                    pitch: 45,
                    bearing: -17.6,
                    duration: 1000
                });
                this.is3DViewEnabled = true;
                if (button) button.textContent = 'Disable 3D View';
                this.info('3D view enabled');
            }
        } catch (error) {
            this.error('Failed to toggle 3D view:', error);
        }
    }

    /**
     * Show extrusion status message
     */
    showExtrusionStatus(message, type = 'info') {
        const statusElement = document.getElementById('extrusionStatus');
        if (!statusElement) return;

        statusElement.textContent = message;
        statusElement.className = `floorplan-status ${type}`;
        statusElement.style.display = 'block';

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        try {
            // Remove layers
            if (this.map.getLayer('building-extrusion-layer')) {
                this.map.removeLayer('building-extrusion-layer');
            }

            // Remove sources
            if (this.map.getSource('building-extrusions')) {
                this.map.removeSource('building-extrusions');
            }

            // Clear active extrusions
            this.activeExtrusions.clear();

            this.info('Extrusion3DManager cleaned up');
        } catch (error) {
            this.error('Error during cleanup:', error);
        }
    }
}

// Make it globally available
window.Extrusion3DManager = Extrusion3DManager;
