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
        this.draw = null; // MapboxDraw instance
        this.drawStructureManager = null; // Instance of the new DrawStructureManager

        this.isDrawing = false; // Kept for backward compatibility/fallback
        this.structures = [];
        this.currentStructure = null;

        // State management
        this.state = {
            hasFloorplan: false,
            geojsonPolygon: null,
            currentDrawMode: null,
            isExtruded: false,
            drawingPoints: [] // Kept for backward compatibility/fallback
        };

        // UI elements
        this.drawButton = null;
        this.clearButton = null;
        this.statusDisplay = null;
        this.extrudeButton = null; // Added for extrude functionality
        this.stopButton = null; // Added for stop drawing functionality
    }

    async initialize() {
        this.info('Initializing Floorplan Manager...');

        try {
            if (!this.map) {
                throw new Error('Map instance required for FloorplanManager');
            }

            // Get UI elements with proper fallback - check multiple possible IDs
            this.drawButton = document.getElementById('drawFloorplanButton') ||
                             document.getElementById('drawStructureButton') ||
                             document.querySelector('[data-action="draw-structure"]') ||
                             document.querySelector('.draw-structure-btn') ||
                             document.querySelector('#floorplanCard .draw-button');
            this.clearButton = document.getElementById('clearStructuresButton') ||
                              document.getElementById('clearFloorplanButton');
            this.extrudeButton = document.getElementById('extrudeStructureButton');
            this.stopButton = document.getElementById('stopStructureDrawingButton');

            // Initialize the DrawStructureManager
            // Pass the map instance and draw control to it
            if (typeof DrawStructureManager !== 'undefined') {
                this.drawStructureManager = new DrawStructureManager(this.map, this);
                await this.drawStructureManager.initialize();
                this.info('DrawStructureManager initialized');
            } else {
                this.warn('DrawStructureManager class not found. Drawing functionality will be limited.');
                // Ensure fallback methods are available
                this.setupDrawEventHandlersFallback();
            }


            // Setup event handlers
            this.setupEventHandlers();

            // Initialize state
            this.isDrawing = false; // Default state
            this.structures = [];

            // Ensure UI is in correct initial state
            this.updateStructureControls(false);

            this.info('✅ Floorplan Manager initialized successfully');
        } catch (error) {
            this.error('Failed to initialize FloorplanManager:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        this.info('Setting up event handlers...');

        // UI Event Handlers with better error handling
        this.setupDrawButtonListener();

        if (!this.drawButton) {
            this.warn('Draw structure button not found in DOM - checking alternatives...');

            const alternativeButtons = [
                document.querySelector('#drawFloorplanButton'),
                document.querySelector('.draw-button'),
                document.querySelector('.draw-structure-btn'),
                document.querySelector('[onclick*="draw"]'),
                document.querySelector('.btn[data-action="draw-structure"]'),
                document.querySelector('#floorplanControls .draw-button'),
                document.querySelector('#floorplanCard .btn:first-child')
            ];

            for (let i = 0; i < alternativeButtons.length; i++) {
                if (alternativeButtons[i]) {
                    this.drawButton = alternativeButtons[i];
                    this.setupDrawButtonListener(); // Re-setup listener for the found button
                    this.info('✅ Found alternative draw button and attached listener');
                    break;
                }
            }

            if (!this.drawButton) {
                this.error('Could not find draw structure button with any selector');
            }
        }

        if (this.stopButton) {
            this.stopButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.stopDrawing();
            });
        }

        if (this.clearButton) {
            this.clearButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.clearStructure();
            });
        }

        if (this.extrudeButton) {
            this.extrudeButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.extrudeStructure();
            });
        }

        // Setup draw control event handlers via the DrawStructureManager
        if (this.drawStructureManager) {
            this.drawStructureManager.setupDrawEventHandlers();
        } else {
            // Fallback if DrawStructureManager is not available
            this.setupDrawEventHandlersFallback();
        }


        // Listen for other tool activations to stop structure drawing
        if (window.eventBus) {
            window.eventBus.on('tool-activated', (toolName) => {
                // If a different tool is activated and we are drawing, stop drawing
                if (toolName !== 'floorplan' && this.isDrawingActive()) {
                    this.info(`Other tool '${toolName}' activated, stopping structure drawing`);
                    this.stopDrawing();
                }
            });
        }

        this.info('Event handlers setup completed');
    }

    setupDrawButtonListener() {
        if (this.drawButton) {
            this.drawButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.info('Draw structure button clicked');
                this.toggleDrawingMode();
            });
            this.info('✅ Draw structure button listener attached');
        }
    }

    // Fallback for setting up draw event handlers if DrawStructureManager is not available
    setupDrawEventHandlersFallback() {
        this.info('Setting up fallback draw event handlers...');

        const checkDraw = () => {
            const core = window.siteInspectorCore;
            if (core && core.draw) {
                this.draw = core.draw; // Use the internal draw property
                this.info('Draw control found, setting up map event handlers');

                // Map Drawing Event Handlers
                this.map.on('draw.create', (e) => this.handleStructureCreated(e));
                this.map.on('draw.update', (e) => this.handleStructureUpdated(e));
                this.map.on('draw.delete', (e) => this.handleStructureDeleted(e));

                return true;
            }
            return false;
        };

        if (!checkDraw()) {
            this.info('Draw control not ready, will retry...');
            let attempts = 0;
            const maxAttempts = 20;

            const retryInterval = setInterval(() => {
                attempts++;
                if (checkDraw() || attempts >= maxAttempts) {
                    clearInterval(retryInterval);
                    if (attempts >= maxAttempts) {
                        this.warn('Draw control not available after maximum retries');
                    }
                }
            }, 250);
        }
    }


    toggleDrawingMode() {
        this.info('Toggle drawing mode called - current state:', this.isDrawing);

        if (this.drawStructureManager && typeof this.drawStructureManager.toggleDrawing === 'function') {
            this.info('Using DrawStructureManager for toggle');
            this.drawStructureManager.toggleDrawing();
        } else {
            this.warn('DrawStructureManager not available, using fallback toggle');
            if (this.isDrawing) {
                this.stopDrawing();
            } else {
                this.startDrawing();
            }
        }
    }

    startDrawing() {
        if (this.drawStructureManager && typeof this.drawStructureManager.startDrawing === 'function') {
            this.drawStructureManager.startDrawing();
        } else {
            this.warn('DrawStructureManager not available, using fallback start drawing');
            this.isDrawing = true;
            this.updateDrawButton(true);
            this.showStatus('Click on the map to start drawing structure footprint', 'info');

            // Emit event for UI updates
            window.eventBus?.emit?.('tool-activated', 'floorplan');
        }
    }

    clearExistingStructures() {
        try {
            // Remove existing structure visualization layers
            this.removeStructureVisualization();
            // Also clear from draw control if possible and needed
            if (this.drawStructureManager) {
                this.drawStructureManager.clearStructureDrawingFeatures();
            } else if (this.draw) {
                this.clearStructureDrawingFeatures();
            }
            this.info('Cleared existing structure visualizations');
        } catch (error) {
            this.warn('Could not clear existing structures:', error);
        }
    }

    clearStructureDrawingFeatures() {
        // This method is now primarily handled by DrawStructureManager,
        // but kept for fallback if DrawStructureManager is not available.
        try {
            if (this.draw && typeof this.draw.getAll === 'function') {
                const allFeatures = this.draw.getAll();
                const structureFeatures = allFeatures.features.filter(feature =>
                    feature.properties &&
                    (feature.properties.type === 'structure' ||
                     feature.properties.name === 'Structure Footprint' ||
                     feature.properties.layer_type === 'structure_footprint')
                );

                if (structureFeatures.length > 0) {
                    const structureIds = structureFeatures.map(f => f.id);
                    this.draw.delete(structureIds);
                    this.info(`Cleared ${structureFeatures.length} structure features from draw control (fallback)`);
                }
            }
        } catch (error) {
            this.warn('Could not clear structure drawing features (fallback):', error);
        }
    }

    stopDrawing() {
        if (this.drawStructureManager && typeof this.drawStructureManager.stopDrawing === 'function') {
            this.drawStructureManager.stopDrawing();
        } else {
            this.warn('DrawStructureManager not available, using fallback stop drawing');
            this.isDrawing = false;
            this.updateDrawButton(false);
            this.showStatus('Drawing stopped', 'info');
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
        // Show/hide the stop button based on drawing state
        if (this.stopButton) {
            this.stopButton.style.display = isDrawing ? 'inline-block' : 'none';
        }
        // Disable draw button when drawing (or delegate to manager)
        if (this.drawButton) {
            this.drawButton.disabled = isDrawing;
        }
    }

    handleStructureCreated(e) {
        // This method is now primarily handled by DrawStructureManager,
        // but kept for fallback if DrawStructureManager is not available.
        try {
            const feature = e.features[0];
            if (!feature || feature.geometry.type !== 'Polygon') {
                return;
            }

            this.info('Structure created (fallback):', feature);

            const coordinates = feature.geometry.coordinates[0];
            const structureFeature = {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                },
                properties: {
                    type: 'structure',
                    name: 'Structure Footprint'
                }
            };

            // Immediately remove from draw control to prevent interference with site boundary
            if (this.draw && feature.id) {
                this.draw.delete([feature.id]);
                this.info('Structure removed from draw control to preserve site boundary independence (fallback)');
            }

            this.currentStructure = structureFeature;
            this.state.geojsonPolygon = structureFeature;
            this.state.hasFloorplan = true;

            const area = this.calculatePolygonArea(coordinates);
            this.info(`Structure area: ${area.toFixed(2)} m² (fallback)`);

            this.addStructureVisualization(structureFeature);

            this.showStatus(`Structure created (${area.toFixed(1)} m²)`, 'success');
            this.updateStructureControls(true);

            this.stopDrawing(); // Stop drawing mode

            window.eventBus.emit('structure-created', {
                feature: structureFeature,
                area: area,
                coordinates: coordinates,
                type: 'structure'
            });

        } catch (error) {
            this.error('Error handling structure creation (fallback):', error);
            this.showStatus('Error creating structure', 'error');
        }
    }

    addStructureVisualization(feature) {
        try {
            const sourceId = 'structure-footprint-independent';
            const fillLayerId = 'structure-footprint-fill-independent';
            const strokeLayerId = 'structure-footprint-stroke-independent';

            this.removeStructureVisualization(); // Ensure cleanup

            this.map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: feature.geometry,
                        properties: {
                            ...feature.properties,
                            layer_type: 'structure_footprint',
                            independent: true
                        }
                    }]
                }
            });

            this.map.addLayer({
                id: fillLayerId,
                type: 'fill',
                source: sourceId,
                paint: {
                    'fill-color': '#ff6b35',
                    'fill-opacity': 0.3
                },
                filter: ['==', ['get', 'layer_type'], 'structure_footprint']
            });

            this.map.addLayer({
                id: strokeLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#ff6b35',
                    'line-width': 3,
                    'line-opacity': 0.8
                },
                filter: ['==', ['get', 'layer_type'], 'structure_footprint']
            });

            this.info('Structure visualization added to map with completely independent layers');
            // Ensure layers are visible
            if (this.map.getLayoutProperty(strokeLayerId, 'visibility') !== 'visible') {
                this.map.setLayoutProperty(strokeLayerId, 'visibility', 'visible');
            }
            if (this.map.getLayoutProperty(fillLayerId, 'visibility') !== 'visible') {
                this.map.setLayoutProperty(fillLayerId, 'visibility', 'visible');
            }


            this.saveStructurePlacementData();
            this.updateStructureUI();

            this.isDrawing = false; // Ensure drawing state is reset

        } catch (error) {
            this.error('Error adding structure visualization:', error);
        }
    }

    handleStructureUpdated(e) {
        // This method is now primarily handled by DrawStructureManager,
        // but kept for fallback if DrawStructureManager is not available.
        if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            this.currentStructure = feature;
            this.state.geojsonPolygon = feature;

            const area = this.calculatePolygonArea(feature.geometry.coordinates[0]);
            this.showStatus(`Structure updated (${area.toFixed(1)} m²)`, 'info');
        }
    }

    handleStructureDeleted(e) {
        // This method is now primarily handled by DrawStructureManager,
        // but kept for fallback if DrawStructureManager is not available.
        this.info('Structure deleted (fallback)');
        this.clearStructureState();
        this.updateStructureControls(false);
        this.showStatus('Structure deleted', 'info');

        window.eventBus.emit('structure-deleted');
    }

    clearStructure() {
        try {
            this.removeStructureVisualization();
            this.clearStructureState();
            this.updateStructureControls(false);
            this.showStatus('Structure cleared', 'info');

            this.info('Structure cleared - site boundary unchanged');

            window.eventBus.emit('structure-deleted');

        } catch (error) {
            this.error('Error clearing structure:', error);
        }
    }

    removeStructureVisualization() {
        const layersToRemove = [
            'structure-footprint-fill-independent',
            'structure-footprint-stroke-independent',
            'structure-preview-fill',
            'structure-preview-line',
            'structure-drawing-points'
        ];

        const sourcesToRemove = [
            'structure-footprint-independent',
            'structure-drawing-preview',
            'structure-drawing-points'
        ];

        layersToRemove.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
                this.info(`Removed structure layer: ${layerId}`);
            }
        });

        sourcesToRemove.forEach(sourceId => {
            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
                this.info(`Removed structure source: ${sourceId}`);
            }
        });

        this.info('Structure visualization completely removed from map');
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

        const extrusionCard = document.getElementById('extrusionCard');
        if (extrusionCard) {
            if (hasStructure) {
                extrusionCard.classList.remove('collapsed');
            } else {
                extrusionCard.classList.add('collapsed');
            }
        }

        if (this.extrudeButton) {
            this.extrudeButton.disabled = !hasStructure;
        }
    }

    extrudeStructure() {
        const heightInput = prompt('Enter extrusion height (in meters):');
        const height = parseFloat(heightInput);

        if (isNaN(height) || height <= 0) {
            this.showStatus('Invalid height entered for extrusion.', 'error');
            return;
        }

        if (!this.currentStructure) {
            this.warn('No structure available to extrude');
            this.showStatus('No structure selected to extrude.', 'warning');
            return;
        }

        try {
            const coordinates = this.currentStructure.geometry.coordinates[0];

            this.removeStructure3D(); // Remove any existing 3D structure

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
        if (!coordinates || coordinates.length < 3) return 0;

        let area = 0;
        const numPoints = coordinates.length - 1;

        for (let i = 0; i < numPoints; i++) {
            const j = (i + 1) % numPoints;
            area += coordinates[i][0] * coordinates[j][1];
            area -= coordinates[j][0] * coordinates[i][1];
        }

        area = Math.abs(area) / 2;

        // Approximate conversion to square meters
        return area * 111319.9 * 111319.9 * Math.cos(coordinates[0][1] * Math.PI / 180);
    }

    showStatus(message, type = 'info') {
        if (this.statusDisplay) {
            this.statusDisplay.textContent = message;
            this.statusDisplay.className = `floorplan-status ${type}`;
            this.statusDisplay.style.display = 'block';

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

    // Delegated to DrawStructureManager or fallback
    isDrawingActive() {
        if (this.drawStructureManager) {
            return this.drawStructureManager.isDrawingActive();
        }
        return this.isDrawing;
    }

    getDrawingPoints() {
        if (this.drawStructureManager) {
            return this.drawStructureManager.getDrawingPoints();
        }
        return this.state.drawingPoints || [];
    }


    // Added methods for drawing preview - Now delegated to DrawStructureManager
    // Keep fallback methods for when DrawStructureManager is not available.

    // Drawing methods now delegated to DrawStructureManager
    // Removed redundant methods like startDrawingMode, stopDrawingMode,
    // setupDrawingPreviewLayers, setupDrawingPreview, removeDrawingPreview,
    // handleDrawingClick, handleDrawingMouseMove, handleDrawingUpdate,
    // updateDrawingPreview, updateLiveDrawingPreview, getStaticPreviewFeatures,
    // addDrawingPointMarker, clearDrawingVisualization, resetDrawingState, updateDrawButton.

    // validateDrawingReadiness now delegates to DrawStructureManager or uses fallback
    validateDrawingReadiness() {
        if (this.drawStructureManager) {
            return this.drawStructureManager.validateDrawingReadiness();
        }

        // Fallback validation
        if (!this.map) {
            this.error('Map instance not available');
            this.showStatus('Map not ready for drawing', 'error');
            return false;
        }

        if (!this.draw) {
            const core = window.siteInspectorCore;
            if (core && core.draw) {
                this.draw = core.draw;
                this.info('Draw control obtained from siteInspectorCore (fallback)');
            } else {
                this.error('Draw control not available');
                this.showStatus('Drawing tools not ready. Please refresh the page.', 'error');
                return false;
            }
        }

        if (typeof this.draw.changeMode !== 'function') {
            this.error('Draw control not properly initialized');
            this.showStatus('Drawing tools are not ready. Please refresh the page.', 'error');
            return false;
        }

        return true;
    }

    // resetDrawingState now delegates to DrawStructureManager or uses fallback
    resetDrawingState() {
        if (this.drawStructureManager) {
            this.drawStructureManager.resetDrawingState();
        } else {
            this.warn('DrawStructureManager not available, using fallback resetDrawingState');
            this.isDrawing = false;
            this.state.drawingPoints = [];
            this.state.currentDrawMode = null;
            this.updateDrawingUI(false);
            // In fallback, clear visualization is handled by stopDrawing
        }
    }

    // updateDrawButton logic is kept here for UI consistency with the drawButton
    updateDrawButton(isActive) {
        if (this.drawButton) {
            if (isActive) {
                this.drawButton.textContent = 'Stop Drawing';
                this.drawButton.classList.add('active');
            } else {
                this.drawButton.textContent = 'Draw Structure';
                this.drawButton.classList.remove('active');
            }
            this.drawButton.disabled = false;
        }
    }

    // updateStructureUI is kept here to manage the overall structure drawing state
    updateStructureUI() {
        const hasStructure = this.state.hasFloorplan;
        this.updateStructureControls(hasStructure);

        if (hasStructure) {
            this.showStatus('Structure footprint ready', 'success');
        }
    }

    // Alias for removeStructureVisualization for compatibility
    removeFloorplanFromMap() {
        this.removeStructureVisualization();
    }

    // Cleanup method that also cleans up DrawStructureManager
    cleanup() {
        if (this.drawStructureManager) {
            this.drawStructureManager.cleanup();
        }
        // Existing cleanup logic for FloorplanManager can be added here if needed
        this.info('FloorplanManager cleanup complete.');
    }

    // Make available globally
    window.FloorplanManager = FloorplanManager;
}