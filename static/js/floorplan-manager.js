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
                             document.querySelector('.draw-structure-btn');
            this.clearButton = document.getElementById('clearStructuresButton') ||
                              document.getElementById('clearFloorplanButton');
            this.extrudeButton = document.getElementById('extrudeStructureButton');
            this.stopButton = document.getElementById('stopStructureDrawingButton');

            // Setup event handlers
            this.setupEventHandlers();

            // Initialize state
            this.isDrawing = false;
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
        if (this.drawButton) {
            this.drawButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.info('Draw structure button clicked');
                this.toggleDrawingMode();
            });
            this.info('✅ Draw structure button found and event listener attached');
        } else {
            this.warn('Draw structure button not found in DOM - checking alternatives...');
            
            // Try to find button by different selectors
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
                    this.drawButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.info('Draw structure button clicked (alternative selector)');
                        this.toggleDrawingMode();
                    });
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

        // Wait for draw control to be available
        this.setupDrawEventHandlers();

        // Listen for other tool activations to stop structure drawing
        if (window.eventBus) {
            window.eventBus.on('tool-activated', (toolName) => {
                if (toolName !== 'floorplan' && this.isDrawing) {
                    this.info(`Other tool '${toolName}' activated, stopping structure drawing`);
                    this.stopDrawing();
                }
            });
        }

        this.info('Event handlers setup completed');
    }

    setupDrawEventHandlers() {
        // Check if draw control is available, if not, wait for it
        const checkDraw = () => {
            const core = window.siteInspectorCore;
            if (core && core.draw) {
                this.draw = core.draw;
                this.info('Draw control found, setting up map event handlers');

                // Map Drawing Event Handlers
                this.map.on('draw.create', (e) => this.handleStructureCreated(e));
                this.map.on('draw.update', (e) => this.handleStructureUpdated(e));
                this.map.on('draw.delete', (e) => this.handleStructureDeleted(e));

                return true;
            }
            return false;
        };

        // Try immediately, then retry if needed
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
        this.info('toggleDrawingMode called - checking draw control availability');
        
        // Try to get draw control from multiple sources
        if (!this.draw) {
            const core = window.siteInspectorCore;
            if (core && core.draw) {
                this.draw = core.draw;
                this.info('Draw control obtained from siteInspectorCore');
            }
        }
        
        if (!this.draw) {
            this.warn('Drawing not available - MapboxDraw not initialized');
            alert('Structure drawing is currently unavailable. Please refresh the page.');
            return;
        }

        if (this.isDrawing) {
            this.info('Currently drawing - stopping drawing mode');
            this.stopDrawing();
        } else {
            this.info('Not currently drawing - starting drawing mode');
            this.startDrawing();
        }
    }

    startDrawing() {
        if (!this.draw) {
            this.error('Cannot start drawing - draw control not available');
            return;
        }

        try {
            this.info('Starting structure drawing mode...');
            
            // Emit tool activation event to stop other tools
            window.eventBus.emit('tool-activated', 'floorplan');

            // Clear any existing structures first
            this.clearExistingStructures();

            // Check if draw control has the required methods
            if (typeof this.draw.changeMode !== 'function') {
                throw new Error('Draw control missing changeMode method');
            }
            
            if (typeof this.draw.getMode !== 'function') {
                throw new Error('Draw control missing getMode method');
            }

            // Get current mode for debugging
            const currentMode = this.draw.getMode();
            this.info(`Current draw mode: ${currentMode}`);

            // Change to polygon drawing mode for structures
            this.draw.changeMode('draw_polygon');
            this.isDrawing = true;
            this.state.currentDrawMode = 'structure';

            // Verify mode change
            const newMode = this.draw.getMode();
            this.info(`New draw mode: ${newMode}`);

            // Update UI
            this.updateDrawingUI(true);

            // Show user feedback
            this.showStatus('Click on the map to start drawing your structure footprint', 'info');

            this.info('✅ Structure drawing mode started successfully');

        } catch (error) {
            this.error('Failed to start drawing mode:', error);
            this.showStatus('Failed to start drawing mode: ' + error.message, 'error');

            // Reset state on error
            this.isDrawing = false;
            this.updateDrawingUI(false);
        }
    }

    clearExistingStructures() {
        try {
            // Remove existing structure visualization layers
            this.removeStructureVisualization();
            
            // Don't touch the draw control's features - structures are managed separately
            this.info('Cleared existing structure visualizations');
        } catch (error) {
            this.warn('Could not clear existing structures:', error);
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
        // Show/hide the stop button based on drawing state
        if (this.stopButton) {
            this.stopButton.style.display = isDrawing ? 'inline-block' : 'none';
        }
        // Disable draw button when drawing
        if (this.drawButton) {
            this.drawButton.disabled = isDrawing;
        }
    }

    handleStructureCreated(e) {
        try {
            const feature = e.features[0];
            if (!feature || feature.geometry.type !== 'Polygon') {
                return;
            }

            this.info('Structure created:', feature);

            // Immediately remove from draw control to prevent interference with site boundary
            if (this.draw && feature.id) {
                this.draw.delete([feature.id]);
            }

            // Create our own structure representation
            const structureFeature = {
                type: 'Feature',
                geometry: feature.geometry,
                properties: {
                    type: 'structure',
                    name: 'Structure Footprint'
                }
            };

            // Store the structure
            this.currentStructure = structureFeature;
            this.state.geojsonPolygon = structureFeature;
            this.state.hasFloorplan = true;

            // Calculate area
            const area = this.calculatePolygonArea(structureFeature.geometry.coordinates[0]);
            this.info(`Structure area: ${area.toFixed(2)} m²`);

            // Add structure visualization layer (separate from site boundary)
            this.addStructureVisualization(structureFeature);

            // Update UI
            this.showStatus(`Structure created (${area.toFixed(1)} m²)`, 'success');
            this.updateStructureControls(true);

            // Stop drawing mode
            this.stopDrawing();

            // Emit event
            window.eventBus.emit('structure-created', {
                feature: structureFeature,
                area: area,
                coordinates: structureFeature.geometry.coordinates[0],
                type: 'structure'
            });

        } catch (error) {
            this.error('Error handling structure creation:', error);
            this.showStatus('Error creating structure', 'error');
        }
    }

    addStructureVisualization(feature) {
        try {
            const sourceId = 'structure-footprint';
            const fillLayerId = 'structure-footprint-fill';
            const strokeLayerId = 'structure-footprint-stroke';

            // Remove existing structure layers
            if (this.map.getLayer(fillLayerId)) {
                this.map.removeLayer(fillLayerId);
            }
            if (this.map.getLayer(strokeLayerId)) {
                this.map.removeLayer(strokeLayerId);
            }
            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
            }

            // Add structure source
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: feature.geometry,
                    properties: feature.properties
                }
            });

            // Add structure fill layer with distinct red color (different from blue site boundary)
            this.map.addLayer({
                id: fillLayerId,
                type: 'fill',
                source: sourceId,
                paint: {
                    'fill-color': '#ff6b35', // Orange-red to distinguish from blue site boundary
                    'fill-opacity': 0.3
                }
            });

            // Add structure stroke layer
            this.map.addLayer({
                id: strokeLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#ff6b35', // Orange-red to distinguish from blue site boundary
                    'line-width': 3,
                    'line-opacity': 0.8
                }
            });

            this.info('Structure visualization added to map with distinct styling');

        } catch (error) {
            this.error('Error adding structure visualization:', error);
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
        try {
            // Remove structure visualization layers (don't touch draw control features)
            this.removeStructureVisualization();

            // Clear state
            this.clearStructureState();

            // Update UI
            this.updateStructureControls(false);
            this.showStatus('Structure cleared', 'info');

            this.info('Structure cleared - site boundary unchanged');

            // Emit event
            window.eventBus.emit('structure-deleted');

        } catch (error) {
            this.error('Error clearing structure:', error);
        }
    }

    removeStructureVisualization() {
        try {
            const layersToRemove = ['structure-footprint-fill', 'structure-footprint-stroke'];
            const sourcesToRemove = ['structure-footprint'];

            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            sourcesToRemove.forEach(sourceId => {
                if (this.map.getSource(sourceId)) {
                    this.map.removeSource(sourceId);
                }
            });

            this.info('Structure visualization removed from map');

        } catch (error) {
            this.error('Error removing structure visualization:', error);
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
        // Also update the extrude button's enabled state
        if (this.extrudeButton) {
            this.extrudeButton.disabled = !hasStructure;
        }
    }

    extrudeStructure() {
        // For now, prompt for height; in future, this might come from UI
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