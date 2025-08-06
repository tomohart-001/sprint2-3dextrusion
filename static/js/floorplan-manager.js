/**
 * Floorplan Manager - Structure Drawing and Management
 * Handles floor plan drawing, scaling, and integration with the site inspector
 */

// Ensure BaseManager is available or provide fallback
if (typeof BaseManager === 'undefined') {
    console.warn('[FloorplanManager] BaseManager not available, using fallback');
    window.BaseManager = class {
        constructor(name) {
            this.name = name;
        }
        info(...args) { console.log(`[${this.name}] INFO:`, ...args); }
        warn(...args) { console.warn(`[${this.name}] WARN:`, ...args); }
        error(...args) { console.error(`[${this.name}] ERROR:`, ...args); }
    };
}

// Only declare FloorplanManager if it doesn't already exist
if (typeof FloorplanManager === 'undefined') {
    window.FloorplanManager = class FloorplanManager extends BaseManager {
    constructor(map) {
        super('FloorplanManager');

        this.map = map;
        this.draw = null;
        this.isDrawing = false;
        this.structures = [];
        this.currentStructure = null;

        // State management
        this.state = {
            hasFloorplan: false,
            geojsonPolygon: null,
            currentDrawMode: null,
            isExtruded: false
        };

        // UI elements
        this.drawButton = null;
        this.clearButton = null;
        this.statusDisplay = null;
    }

    async initialize() {
        this.info('Initializing Floorplan Manager...');

        try {
            // Get draw instance from core
            if (window.siteInspectorCore && window.siteInspectorCore.getDraw()) {
                this.draw = window.siteInspectorCore.getDraw();
            } else {
                this.warn('MapboxDraw not available - structure drawing will be limited');
            }

            // Initialize UI elements
            this.initializeUI();

            // Setup event listeners
            this.setupEventListeners();

            this.info('✅ Floorplan Manager initialized successfully');

        } catch (error) {
            this.error('Failed to initialize Floorplan Manager:', error);
            throw error;
        }
    }

    initializeUI() {
        // Get UI elements
        this.drawButton = document.getElementById('drawStructureButton');
        this.clearButton = document.getElementById('clearFloorplanButton');
        this.statusDisplay = document.querySelector('.floorplan-status');

        // Setup button event listeners
        if (this.drawButton) {
            this.drawButton.addEventListener('click', () => {
                this.toggleDrawingMode();
            });
        }

        if (this.clearButton) {
            this.clearButton.addEventListener('click', () => {
                this.clearStructure();
            });
        }
    }

    setupEventListeners() {
        // Listen for drawing events if draw is available
        if (this.draw) {
            this.map.on('draw.create', (e) => {
                this.handleStructureCreated(e);
            });

            this.map.on('draw.update', (e) => {
                this.handleStructureUpdated(e);
            });

            this.map.on('draw.delete', (e) => {
                this.handleStructureDeleted(e);
            });
        }

        // Listen for global events
        window.eventBus.on('site-boundary-deleted', () => {
            this.clearAllStructures();
        });

        window.eventBus.on('clear-all-dependent-features', () => {
            this.clearAllStructures();
        });
    }

    toggleDrawingMode() {
        if (!this.draw) {
            this.warn('Drawing not available - MapboxDraw not initialized');
            alert('Structure drawing is currently unavailable. Please refresh the page.');
            return;
        }

        if (this.isDrawing) {
            this.stopDrawing();
        } else {
            this.startDrawing();
        }
    }

    startDrawing() {
        if (!this.draw) return;

        try {
            // Emit tool activation event
            window.eventBus.emit('tool-activated', 'floorplan');

            // Safely start polygon drawing mode
            if (typeof this.draw.changeMode === 'function') {
                this.draw.changeMode('draw_polygon');
                this.isDrawing = true;

                // Update UI
                this.updateDrawingUI(true);

                this.info('Structure drawing mode started');
            } else {
                throw new Error('Draw control not properly initialized');
            }

        } catch (error) {
            this.error('Failed to start drawing mode:', error);
            this.showStatus('Failed to start drawing mode', 'error');

            // Reset state on error
            this.isDrawing = false;
            this.updateDrawingUI(false);
        }
    }

    stopDrawing() {
        if (!this.draw) return;

        try {
            this.isDrawing = false;

            // Safely change draw mode with error handling
            try {
                if (this.draw && typeof this.draw.changeMode === 'function') {
                    const currentMode = this.draw.getMode();
                    if (currentMode !== 'simple_select') {
                        this.draw.changeMode('simple_select');
                    }
                }
            } catch (modeError) {
                this.warn('Could not change draw mode:', modeError);
                // Continue with cleanup even if mode change fails
            }

            this.updateDrawingUI(false);
            this.info('Structure drawing mode stopped');
        } catch (error) {
            this.error('Failed to stop drawing mode:', error);
        }
    }

    updateDrawingUI(isDrawing) {
        if (this.drawButton) {
            if (isDrawing) {
                this.drawButton.textContent = 'Stop Drawing';
                this.drawButton.classList.add('active');
            } else {
                this.drawButton.textContent = 'Draw Structure';
                this.drawButton.classList.remove('active');
            }
        }
    }

    handleStructureCreated(e) {
        try {
            const feature = e.features[0];
            if (!feature || feature.geometry.type !== 'Polygon') {
                return;
            }

            this.info('Structure created:', feature);

            // Store the structure
            this.currentStructure = feature;
            this.state.geojsonPolygon = feature;
            this.state.hasFloorplan = true;

            // Calculate area
            const area = this.calculatePolygonArea(feature.geometry.coordinates[0]);
            this.info(`Structure area: ${area.toFixed(2)} m²`);

            // Update UI
            this.showStatus(`Structure created (${area.toFixed(1)} m²)`, 'success');
            this.updateStructureControls(true);

            // Stop drawing mode
            this.stopDrawing();

            // Emit event
            window.eventBus.emit('structure-created', {
                feature: feature,
                area: area,
                coordinates: feature.geometry.coordinates[0]
            });

        } catch (error) {
            this.error('Error handling structure creation:', error);
            this.showStatus('Error creating structure', 'error');
        }
    }

    handleStructureUpdated(e) {
        if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            this.currentStructure = feature;
            this.state.geojsonPolygon = feature;

            const area = this.calculatePolygonArea(feature.geometry.coordinates[0]);
            this.showStatus(`Structure updated (${area.toFixed(1)} m²)`, 'info');
        }
    }

    handleStructureDeleted(e) {
        this.info('Structure deleted');
        this.clearStructureState();
        this.updateStructureControls(false);
        this.showStatus('Structure deleted', 'info');

        window.eventBus.emit('structure-deleted');
    }

    clearStructure() {
        if (!this.draw) return;

        try {
            // Remove all features from draw
            const features = this.draw.getAll();
            if (features.features.length > 0) {
                const featureIds = features.features.map(f => f.id);
                this.draw.delete(featureIds);
            }

            // Clear state
            this.clearStructureState();

            // Update UI
            this.updateStructureControls(false);
            this.showStatus('Structure cleared', 'info');

            this.info('Structure cleared');

        } catch (error) {
            this.error('Error clearing structure:', error);
        }
    }

    clearAllStructures() {
        this.clearStructure();
        this.structures = [];
        this.info('All structures cleared');
    }

    clearStructureState() {
        this.currentStructure = null;
        this.state.geojsonPolygon = null;
        this.state.hasFloorplan = false;
        this.state.isExtruded = false;
    }

    updateStructureControls(hasStructure) {
        if (this.clearButton) {
            this.clearButton.style.display = hasStructure ? 'block' : 'none';
        }

        // Update extrusion controls
        const extrusionCard = document.getElementById('extrusionCard');
        if (extrusionCard && hasStructure) {
            extrusionCard.classList.remove('collapsed');
        }
    }

    extrudeStructure(height) {
        if (!this.currentStructure) {
            this.warn('No structure available to extrude');
            return;
        }

        try {
            const coordinates = this.currentStructure.geometry.coordinates[0];

            // Remove any existing 3D structure
            this.removeStructure3D();

            // Add 3D extrusion layer
            const sourceId = 'structure-3d-extrusion';
            const layerId = 'structure-3d-layer';

            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
            }

            this.map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [coordinates]
                    },
                    properties: {
                        height: height
                    }
                }
            });

            this.map.addLayer({
                id: layerId,
                type: 'fill-extrusion',
                source: sourceId,
                paint: {
                    'fill-extrusion-color': '#007cbf',
                    'fill-extrusion-height': height,
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.8
                }
            });

            this.state.isExtruded = true;
            this.showStatus(`Structure extruded to ${height}m`, 'success');
            this.info(`Structure extruded to ${height}m height`);

            // Emit event
            window.eventBus.emit('extrusion-applied', {
                height: height,
                coordinates: coordinates
            });

        } catch (error) {
            this.error('Failed to extrude structure:', error);
            this.showStatus('Failed to extrude structure', 'error');
        }
    }

    removeStructure3D() {
        const layerId = 'structure-3d-layer';
        const sourceId = 'structure-3d-extrusion';

        if (this.map.getLayer(layerId)) {
            this.map.removeLayer(layerId);
        }

        if (this.map.getSource(sourceId)) {
            this.map.removeSource(sourceId);
        }

        this.state.isExtruded = false;
        this.info('3D structure removed');
    }

    calculatePolygonArea(coordinates) {
        // Simple area calculation using shoelace formula
        if (!coordinates || coordinates.length < 3) return 0;

        let area = 0;
        const numPoints = coordinates.length - 1; // Last point is same as first

        for (let i = 0; i < numPoints; i++) {
            const j = (i + 1) % numPoints;
            area += coordinates[i][0] * coordinates[j][1];
            area -= coordinates[j][0] * coordinates[i][1];
        }

        area = Math.abs(area) / 2;

        // Convert to square meters (approximate)
        // This is a rough conversion - more accurate conversion would need proper projection
        return area * 111319.9 * 111319.9 * Math.cos(coordinates[0][1] * Math.PI / 180);
    }

    showStatus(message, type = 'info') {
        if (this.statusDisplay) {
            this.statusDisplay.textContent = message;
            this.statusDisplay.className = `floorplan-status ${type}`;
            this.statusDisplay.style.display = 'block';

            // Auto-hide after 5 seconds
            setTimeout(() => {
                if (this.statusDisplay) {
                    this.statusDisplay.style.display = 'none';
                }
            }, 5000);
        }
    }

    // Public getters
    hasStructures() {
        return this.state.hasFloorplan;
    }

    getStructures() {
        return this.currentStructure ? [this.currentStructure] : [];
    }

    getCurrentFloorplanCoordinates() {
        if (this.currentStructure && this.currentStructure.geometry) {
            return this.currentStructure.geometry.coordinates[0];
        }
        return null;
    }

    isDrawingActive() {
        return this.isDrawing;
    }

        // Add missing methods for fallback compatibility
        clearAllFloorplanData() {
            this.clearAllStructures();
        }
    }

    // Make available globally
    window.FloorplanManager = FloorplanManager;
}