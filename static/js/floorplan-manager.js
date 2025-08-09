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
            isExtruded: false,
            drawingPoints: []
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

    clearStructureDrawingFeatures() {
        try {
            // Only clear features that are specifically structure-related
            // Do NOT clear features that might be the site boundary
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
                    this.info(`Cleared ${structureFeatures.length} structure features from draw control`);
                }
            }
        } catch (error) {
            this.warn('Could not clear structure drawing features:', error);
        }
    }

    stopDrawing() {
        if (!this.draw) return;

        try {
            this.isDrawing = false;

            // Safely change draw mode back to simple_select without affecting site boundary
            try {
                if (this.draw && typeof this.draw.changeMode === 'function') {
                    const currentMode = this.draw.getMode();
                    if (currentMode !== 'simple_select') {
                        this.draw.changeMode('simple_select');
                        this.info('Draw mode reset to simple_select, preserving site boundary integrity');
                    }
                }
            } catch (modeError) {
                this.warn('Could not change draw mode:', modeError);
                // Continue with cleanup even if mode change fails
            }

            // Clear any structure-related drawing features without touching site boundary
            this.clearStructureDrawingFeatures();

            this.updateDrawingUI(false);
            this.info('Structure drawing mode stopped - site boundary preserved');
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

            // Store the original feature data before removing from draw control
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
            // This ensures the structure doesn't affect the site boundary system
            if (this.draw && feature.id) {
                this.draw.delete([feature.id]);
                this.info('Structure removed from draw control to preserve site boundary independence');
            }

            // Store the structure independently
            this.currentStructure = structureFeature;
            this.state.geojsonPolygon = structureFeature;
            this.state.hasFloorplan = true;

            // Calculate area
            const area = this.calculatePolygonArea(coordinates);
            this.info(`Structure area: ${area.toFixed(2)} m²`);

            // Add structure visualization layer (completely separate from site boundary)
            this.addStructureVisualization(structureFeature);

            // Update UI
            this.showStatus(`Structure created (${area.toFixed(1)} m²)`, 'success');
            this.updateStructureControls(true);

            // Stop drawing mode and reset draw control to simple_select
            this.stopDrawing();

            // Emit event
            window.eventBus.emit('structure-created', {
                feature: structureFeature,
                area: area,
                coordinates: coordinates,
                type: 'structure'
            });

        } catch (error) {
            this.error('Error handling structure creation:', error);
            this.showStatus('Error creating structure', 'error');
        }
    }

    addStructureVisualization(feature) {
        try {
            // Use completely separate source and layer IDs for structure footprint
            const sourceId = 'structure-footprint-independent';
            const fillLayerId = 'structure-footprint-fill-independent';
            const strokeLayerId = 'structure-footprint-stroke-independent';

            // Remove existing structure layers (ensure complete cleanup)
            this.removeStructureVisualization();

            // Add structure source with independent naming
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

            // Add structure fill layer with distinct orange color (different from blue site boundary)
            this.map.addLayer({
                id: fillLayerId,
                type: 'fill',
                source: sourceId,
                paint: {
                    'fill-color': '#ff6b35', // Orange color to distinguish from blue site boundary
                    'fill-opacity': 0.3
                },
                filter: ['==', ['get', 'layer_type'], 'structure_footprint']
            });

            // Add structure stroke layer
            this.map.addLayer({
                id: strokeLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': '#ff6b35', // Orange color to distinguish from blue site boundary
                    'line-width': 3,
                    'line-opacity': 0.8
                },
                filter: ['==', ['get', 'layer_type'], 'structure_footprint']
            });

            this.info('Structure visualization added to map with completely independent layers');
            this.map.setLayoutProperty('structure-footprint-stroke-independent', 'visibility', 'visible');
            this.map.setLayoutProperty('structure-footprint-fill-independent', 'visibility', 'visible');

            // Save structure placement data for persistence to other pages
            this.saveStructurePlacementData();

            // Update UI to show structure is drawn
            this.updateStructureUI();

            this.info('Draw mode reset to simple_select, preserving site boundary integrity');
            this.isDrawing = false;

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
        // Remove structure-specific visualization layers
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
        this.info('Clearing all floorplan data');

        // Clear the main state
        this.state.geojsonPolygon = null;
        this.state.isDrawing = false;
        this.state.isLocked = false;

        // Clear visualization
        this.removeFloorplanFromMap();

        // Clear structure placement data from session
        this.clearStructurePlacementData();

        // Update UI
        this.updateStructureUI();

        this.info('All floorplan data cleared');
    }

    saveStructurePlacementData() {
        if (!this.state.geojsonPolygon) {
            this.warn('No structure to save');
            return;
        }

        try {
            const coordinates = this.state.geojsonPolygon.geometry.coordinates[0];
            const area = this.calculatePolygonArea(coordinates);

            // Calculate center point
            const centerLng = coordinates.reduce((sum, coord) => sum + coord[0], 0) / coordinates.length;
            const centerLat = coordinates.reduce((sum, coord) => sum + coord[1], 0) / coordinates.length;

            // Calculate approximate dimensions (for rectangular structures)
            const bounds = this.calculateBounds(coordinates);
            const width = Math.abs(bounds.maxLng - bounds.minLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
            const length = Math.abs(bounds.maxLat - bounds.minLat) * 111320;

            const structureData = {
                coordinates: coordinates,
                area_m2: area,
                center: {
                    lat: centerLat,
                    lng: centerLng
                },
                dimensions: {
                    width: Math.round(width * 10) / 10,
                    length: Math.round(length * 10) / 10
                },
                type: 'structure_placement',
                timestamp: new Date().toISOString(),
                project_id: this.getProjectId()
            };

            // Store in session for immediate access
            sessionStorage.setItem('structure_placement_data', JSON.stringify(structureData));

            // Also store in localStorage for persistence across sessions
            const projectId = this.getProjectId();
            if (projectId) {
                localStorage.setItem(`structure_placement_${projectId}`, JSON.stringify(structureData));
            }

            this.info('Structure placement data saved:', structureData);
        } catch (error) {
            this.error('Failed to save structure placement data:', error);
        }
    }

    clearStructurePlacementData() {
        try {
            sessionStorage.removeItem('structure_placement_data');

            const projectId = this.getProjectId();
            if (projectId) {
                localStorage.removeItem(`structure_placement_${projectId}`);
            }

            this.info('Structure placement data cleared');
        } catch (error) {
            this.error('Failed to clear structure placement data:', error);
        }
    }

    calculateBounds(coordinates) {
        const lngs = coordinates.map(coord => coord[0]);
        const lats = coordinates.map(coord => coord[1]);

        return {
            minLng: Math.min(...lngs),
            maxLng: Math.max(...lngs),
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats)
        };
    }

    getProjectId() {
        // Get project ID from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        let projectId = urlParams.get('project_id') || urlParams.get('project') ||
                       sessionStorage.getItem('current_project_id') ||
                       sessionStorage.getItem('project_id');

        // Clean up malformed project IDs (remove any extra parameters)
        if (projectId && typeof projectId === 'string' && projectId.includes('?')) {
            projectId = projectId.split('?')[0];
        }

        return projectId;
    }

    // Added methods for drawing preview
    startDrawingMode() {
        if (!this.validateDrawingReadiness()) {
            return;
        }

        try {
            this.info('Starting structure drawing mode...');

            // Emit tool activation event
            window.eventBus.emit('tool-activated', 'floorplan');

            // Clear any existing structure visualizations
            this.removeStructureVisualization();

            // Initialize drawing state
            this.state.isDrawing = true;
            this.state.drawingPoints = [];
            this.updateDrawButton(true);

            // Set up drawing preview sources and layers
            this.setupDrawingPreviewLayers();

            // Set up drawing event listeners for live preview
            this.setupDrawingPreview();

            // Get current mode for debugging
            const currentMode = this.draw ? this.draw.getMode() : 'unknown';
            this.info('Current draw mode:', currentMode);

            // Start polygon drawing mode
            this.draw.changeMode('draw_polygon');

            const newMode = this.draw ? this.draw.getMode() : 'unknown';
            this.info('New draw mode:', newMode);

            this.info('✅ Structure drawing mode started successfully');

        } catch (error) {
            this.error('Failed to start structure drawing mode:', error);
            this.resetDrawingState();
            this.showStatus('Failed to start drawing mode: ' + (error.message || 'Unknown error'), 'error');
        }
    }

    stopDrawingMode() {
        if (!this.draw) return;

        try {
            this.state.isDrawing = false;
            this.state.drawingPoints = [];
            this.removeDrawingPreview();
            this.clearDrawingVisualization();
            this.draw.changeMode('simple_select');
            this.updateDrawButton(false);
            this.info('Draw mode reset to simple_select, preserving site boundary integrity');
            this.info('Structure drawing mode stopped - site boundary preserved');
        } catch (error) {
            this.error('Failed to stop structure drawing mode:', error);
        }
    }

    setupDrawingPreviewLayers() {
        const emptyFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        // Add preview source for drawing lines and polygons
        if (!this.map.getSource('structure-drawing-preview')) {
            this.map.addSource('structure-drawing-preview', {
                type: 'geojson',
                data: emptyFeatureCollection
            });
        }

        // Add points source for vertex markers
        if (!this.map.getSource('structure-drawing-points')) {
            this.map.addSource('structure-drawing-points', {
                type: 'geojson',
                data: emptyFeatureCollection
            });
        }

        // Add preview fill layer
        if (!this.map.getLayer('structure-preview-fill')) {
            this.map.addLayer({
                id: 'structure-preview-fill',
                type: 'fill',
                source: 'structure-drawing-preview',
                paint: {
                    'fill-color': [
                        'case',
                        ['==', ['get', 'type'], 'preview-polygon-live'],
                        '#28a745',
                        '#20c997'
                    ],
                    'fill-opacity': [
                        'case',
                        ['==', ['get', 'type'], 'preview-polygon-live'],
                        0.2,
                        0.3
                    ]
                },
                filter: ['in', ['get', 'type'], ['literal', ['preview-polygon', 'preview-polygon-live']]]
            });
        }

        // Add preview line layer
        if (!this.map.getLayer('structure-preview-line')) {
            this.map.addLayer({
                id: 'structure-preview-line',
                type: 'line',
                source: 'structure-drawing-preview',
                paint: {
                    'line-color': [
                        'case',
                        ['==', ['get', 'type'], 'preview-line-live'],
                        '#28a745',
                        '#20c997'
                    ],
                    'line-width': [
                        'case',
                        ['==', ['get', 'type'], 'preview-line-live'],
                        2,
                        3
                    ],
                    'line-dasharray': [
                        'case',
                        ['==', ['get', 'type'], 'preview-line-live'],
                        ['literal', [2, 2]],
                        ['literal', []]
                    ],
                    'line-opacity': 0.8
                },
                filter: ['in', ['get', 'type'], ['literal', ['preview-line', 'preview-line-live']]]
            });
        }

        // Add points layer for vertices
        if (!this.map.getLayer('structure-drawing-points')) {
            this.map.addLayer({
                id: 'structure-drawing-points',
                type: 'circle',
                source: 'structure-drawing-points',
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#28a745',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                    'circle-opacity': 1.0
                }
            });
        }
    }

    setupDrawingPreview() {
        // Add map click listener for adding points
        this.handleDrawingClick = this.handleDrawingClick.bind(this);
        this.handleDrawingMouseMove = this.handleDrawingMouseMove.bind(this);
        this.handleDrawingUpdate = this.handleDrawingUpdate.bind(this);

        this.map.on('click', this.handleDrawingClick);
        this.map.on('mousemove', this.handleDrawingMouseMove);
        this.map.on('draw.update', this.handleDrawingUpdate);

        this.info('Drawing preview listeners set up');
    }

    removeDrawingPreview() {
        try {
            if (this.handleDrawingClick) {
                this.map.off('click', this.handleDrawingClick);
            }
            if (this.handleDrawingMouseMove) {
                this.map.off('mousemove', this.handleDrawingMouseMove);
            }
            if (this.handleDrawingUpdate) {
                this.map.off('draw.update', this.handleDrawingUpdate);
            }
            this.info('Drawing preview listeners removed');
        } catch (error) {
            this.warn('Error removing drawing preview listeners:', error);
        }
    }

    handleDrawingClick(e) {
        if (!this.state.isDrawing) return;

        try {
            const point = [e.lngLat.lng, e.lngLat.lat];
            this.state.drawingPoints.push(point);

            this.info(`Drawing point ${this.state.drawingPoints.length} added:`, point);

            // Update the preview visualization
            this.updateDrawingPreview();

            // Add point marker
            this.addDrawingPointMarker(point, this.state.drawingPoints.length - 1);

        } catch (error) {
            this.error('Error handling drawing click:', error);
        }
    }

    handleDrawingMouseMove(e) {
        if (!this.state.isDrawing || this.state.drawingPoints.length === 0) return;

        try {
            const mousePoint = [e.lngLat.lng, e.lngLat.lat];
            this.updateLiveDrawingPreview(mousePoint);
        } catch (error) {
            // Suppress mouse move errors to avoid spam
            console.debug('Mouse move error:', error.message);
        }
    }

    handleDrawingUpdate(e) {
        if (!this.state.isDrawing) return;

        try {
            // Update our internal points array from the draw tool
            if (e.features && e.features[0] && e.features[0].geometry && e.features[0].geometry.coordinates) {
                const coords = e.features[0].geometry.coordinates[0];
                if (coords && coords.length > 0) {
                    this.state.drawingPoints = coords.slice(0, -1); // Remove the duplicate closing point
                    this.updateDrawingPreview();
                }
            }
        } catch (error) {
            this.warn('Error handling drawing update:', error);
        }
    }

    updateDrawingPreview() {
        try {
            const features = [];

            // Always show points if we have any
            if (this.state.drawingPoints.length >= 1) {
                // Create preview line if we have 2+ points
                if (this.state.drawingPoints.length >= 2) {
                    const lineFeature = {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: this.state.drawingPoints
                        },
                        properties: {
                            type: 'preview-line'
                        }
                    };
                    features.push(lineFeature);
                }

                // Create preview fill if we have 3+ points
                if (this.state.drawingPoints.length >= 3) {
                    const closedCoords = [...this.state.drawingPoints, this.state.drawingPoints[0]];
                    const fillFeature = {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [closedCoords]
                        },
                        properties: {
                            type: 'preview-polygon'
                        }
                    };
                    features.push(fillFeature);
                }

                // Update preview source
                this.map.getSource('structure-drawing-preview').setData({
                    type: 'FeatureCollection',
                    features: features
                });

                this.info(`Drawing preview updated with ${features.length} features and ${this.state.drawingPoints.length} points`);
            } else {
                this.clearDrawingVisualization();
            }

        } catch (error) {
            this.error('Error updating drawing preview:', error);
        }
    }

    updateLiveDrawingPreview(mousePoint) {
        if (this.state.drawingPoints.length === 0) return;

        try {
            // Get static features first
            const staticFeatures = this.getStaticPreviewFeatures();
            const liveFeatures = [];

            // Create live preview line from last point to mouse
            if (this.state.drawingPoints.length >= 1) {
                const lastPoint = this.state.drawingPoints[this.state.drawingPoints.length - 1];
                const liveLineFeature = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [lastPoint, mousePoint]
                    },
                    properties: {
                        type: 'preview-line-live'
                    }
                };
                liveFeatures.push(liveLineFeature);
            }

            // Create polygon preview if we have 2+ points
            if (this.state.drawingPoints.length >= 2) {
                const previewCoords = [...this.state.drawingPoints, mousePoint, this.state.drawingPoints[0]];
                const livePolygonFeature = {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [previewCoords]
                    },
                    properties: {
                        type: 'preview-polygon-live'
                    }
                };
                liveFeatures.push(livePolygonFeature);
            }

            // Update preview with both static and live elements
            this.map.getSource('structure-drawing-preview').setData({
                type: 'FeatureCollection',
                features: [...staticFeatures, ...liveFeatures]
            });

        } catch (error) {
            // Suppress frequent mouse move errors
            console.debug('Live preview error:', error.message);
        }
    }

    getStaticPreviewFeatures() {
        const features = [];

        if (this.state.drawingPoints.length >= 2) {
            // Static line through existing points
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: this.state.drawingPoints
                },
                properties: {
                    type: 'preview-line'
                }
            });
        }

        // Add static polygon if we have 3+ points
        if (this.state.drawingPoints.length >= 3) {
            const closedCoords = [...this.state.drawingPoints, this.state.drawingPoints[0]];
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [closedCoords]
                },
                properties: {
                    type: 'preview-polygon'
                }
            });
        }

        return features;
    }

    addDrawingPointMarker(point, index) {
        try {
            const pointFeature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: point
                },
                properties: {
                    index: index,
                    type: 'drawing-point'
                }
            };

            // Get existing points
            const existingSource = this.map.getSource('structure-drawing-points');
            if (existingSource && existingSource._data) {
                const currentData = existingSource._data;
                currentData.features.push(pointFeature);
                existingSource.setData(currentData);
            } else {
                existingSource.setData({
                    type: 'FeatureCollection',
                    features: [pointFeature]
                });
            }

        } catch (error) {
            this.error('Error adding drawing point marker:', error);
        }
    }

    clearDrawingVisualization() {
        const emptyFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        try {
            const previewSource = this.map.getSource('structure-drawing-preview');
            if (previewSource) {
                previewSource.setData(emptyFeatureCollection);
            }

            const pointsSource = this.map.getSource('structure-drawing-points');
            if (pointsSource) {
                pointsSource.setData(emptyFeatureCollection);
            }

            this.state.drawingPoints = [];
        } catch (error) {
            this.warn('Error clearing drawing visualization:', error);
        }
    }

    // Need to rename startDrawingMode and stopDrawingMode to startDrawing and stopDrawing respectively
    // to match the existing calls in the code.
    startDrawing = this.startDrawingMode;
    stopDrawing = this.stopDrawingMode;
    }

    // Make available globally
    window.FloorplanManager = FloorplanManager;
}