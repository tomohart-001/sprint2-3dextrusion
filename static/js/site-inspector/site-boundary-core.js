/**
 * Site Boundary Core - Refactored Implementation
 * Handles all site boundary operations including drawing, validation, and buildable area calculations
 */

class SiteBoundaryCore extends MapManagerBase {
    constructor(map, draw) {
        super('SiteBoundaryCore', map);
        this.draw = draw;
        this.sitePolygon = null;
        this.polygonEdges = [];
        this.isLocked = false;
        this.isDrawing = false;
        this.drawingPoints = [];
        this.buildableAreaData = null;
        this.previewAbortController = null;

        // Configuration
        this.config = {
            minPolygonPoints: 3,
            coordinateTolerance: 0.000001,
            maxCoordinateRetries: 3,
            defaultBufferMeters: 50
        };

        // Source and layer management
        this.sources = new Map();
        this.layers = new Map();

        this.initializeSources();
        this.initializeLayers();
    }

    initializeSources() {
        this.sourceIds = {
            preview: 'boundary-drawing-preview',
            points: 'boundary-drawing-points',
            dimensions: 'boundary-dimensions',
            final: 'site-boundary-final',
            buildableArea: 'buildable-area'
        };
    }

    initializeLayers() {
        this.layerIds = {
            previewLine: 'boundary-preview-line',
            previewFill: 'boundary-preview-fill',
            points: 'boundary-drawing-points',
            dimensions: 'boundary-dimension-labels',
            finalFill: 'site-boundary-fill',
            finalStroke: 'site-boundary-stroke',
            buildableAreaFill: 'buildable-area-fill',
            buildableAreaStroke: 'buildable-area-stroke'
        };
    }

    async validateDependencies() {
        await super.validateDependencies();

        if (!this.draw) {
            this.warn('MapboxDraw not available - drawing features limited');
            return false;
        }

        return true;
    }

    async setup() {
        try {
            this.setupDrawingSources();
            this.setupDrawingLayers();
            this.setupEventHandlers();
            this.info('Site boundary core setup completed');
        } catch (error) {
            this.error('Failed to setup site boundary core:', error);
            throw error;
        }
    }

    async postInitialize() {
        try {
            await this.loadExistingSiteBoundary();
            this.enableDrawingTools();
            this.info('Site boundary post-initialization completed');
        } catch (error) {
            this.error('Post-initialization failed:', error);
        }
    }

    setupDrawingSources() {
        const emptyFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        Object.values(this.sourceIds).forEach(sourceId => {
            try {
                this.addSource(sourceId, {
                    type: 'geojson',
                    data: emptyFeatureCollection
                });
                this.sources.set(sourceId, true);
            } catch (error) {
                this.error(`Failed to add source ${sourceId}:`, error);
            }
        });
    }

    setupDrawingLayers() {
        const config = window.SiteInspectorConfig;
        if (!config) {
            this.error('SiteInspectorConfig not available');
            return;
        }

        const layerConfigs = [
            {
                id: this.layerIds.previewFill,
                type: 'fill',
                source: this.sourceIds.preview,
                paint: {
                    'fill-color': [
                        'case',
                        ['==', ['get', 'type'], 'preview-polygon-live'],
                        '#ff6b35',
                        '#547bf7'
                    ],
                    'fill-opacity': [
                        'case',
                        ['==', ['get', 'type'], 'preview-polygon-live'],
                        0.2,
                        0.3
                    ]
                },
                filter: ['in', ['get', 'type'], ['literal', ['preview-polygon', 'preview-polygon-live']]]
            },
            {
                id: this.layerIds.previewLine,
                type: 'line',
                source: this.sourceIds.preview,
                paint: {
                    'line-color': [
                        'case',
                        ['==', ['get', 'type'], 'preview-line-live'],
                        '#ff6b35',
                        '#547bf7'
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
            },
            {
                id: this.layerIds.points,
                type: 'circle',
                source: this.sourceIds.points,
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#547bf7',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                    'circle-opacity': 1.0
                }
            },
            {
                id: this.layerIds.dimensions,
                type: 'symbol',
                source: this.sourceIds.dimensions,
                layout: {
                    'text-field': ['get', 'distance'],
                    'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                    'text-size': 12,
                    'text-offset': [0, -1],
                    'text-anchor': 'center',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'visibility': 'visible'
                },
                paint: {
                    'text-color': config.get('colors.primary'),
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                }
            },
            {
                id: this.layerIds.buildableAreaFill,
                type: 'fill',
                source: this.sourceIds.buildableArea,
                paint: {
                    'fill-color': '#002040',
                    'fill-opacity': 0.4
                }
            },
            {
                id: this.layerIds.buildableAreaStroke,
                type: 'line',
                source: this.sourceIds.buildableArea,
                paint: {
                    'line-color': '#002040',
                    'line-width': 3,
                    'line-opacity': 0.8
                }
            }
        ];

        layerConfigs.forEach(layerConfig => {
            try {
                this.addLayer(layerConfig);
                this.layers.set(layerConfig.id, true);
            } catch (error) {
                this.error(`Failed to add layer ${layerConfig.id}:`, error);
            }
        });
    }

    setupEventHandlers() {
        // Setup UI handlers immediately
        this.setupUIEventHandlers();

        // Setup map drawing handlers with defensive approach
        if (this.draw && this.map) {
            this.setupDrawingEventHandlers();
        } else {
            this.warn('Map or draw not available for event handlers');
        }
    }

    setupUIEventHandlers() {
        const handlers = [
            { id: 'drawPolygonButton', handler: () => this.safeToggleDrawingMode() },
            { id: 'stopDrawingButton', handler: () => this.safeStopDrawingMode() },
            { id: 'clearBoundaryButton', handler: () => this.safeClearBoundary() },
            { id: 'clearBoundaryButton2', handler: () => this.safeClearBoundary() },
            { id: 'confirmBoundaryButton', handler: () => this.safeConfirmBoundary() },
            { id: 'useLegalBoundaryButton', handler: () => this.safeUseLegalBoundary() }
        ];

        handlers.forEach(({ id, handler }) => {
            try {
                const element = this.getElementById(id, false);
                if (element) {
                    element.addEventListener('click', handler);
                    this.cleanup.push(() => {
                        try {
                            element.removeEventListener('click', handler);
                        } catch (error) {
                            console.debug('Cleanup error for', id, ':', error.message);
                        }
                    });
                }
            } catch (error) {
                this.warn(`Failed to setup handler for ${id}:`, error);
            }
        });

        // Listen for comprehensive clearing event
        window.eventBus.on('clear-all-dependent-features', () => {
            this.info('Comprehensive clearing requested - removing site boundary');
            this.clearBoundary();
        });

        // Listen for comprehensive site data clearing
        window.eventBus.on('clear-all-site-data', () => {
            this.info('Complete site data clearing requested - removing all boundary data');
            this.clearBoundary();
        });

        // Setup legal boundary button state based on location
        this.setupLegalBoundaryButtonState();
    }

    setupDrawingEventHandlers() {
        const eventHandlers = [
            { event: 'draw.create', handler: (e) => this.safeHandlePolygonCreated(e) },
            { event: 'draw.update', handler: (e) => this.safeHandlePolygonUpdated(e) },
            { event: 'draw.delete', handler: (e) => this.safeHandlePolygonDeleted(e) },
            { event: 'draw.modechange', handler: (e) => this.safeHandleModeChange(e) }
        ];

        eventHandlers.forEach(({ event, handler }) => {
            try {
                this.map.on(event, handler);
                this.cleanup.push(() => {
                    try {
                        this.map.off(event, handler);
                    } catch (error) {
                        console.debug('Cleanup error for', event, ':', error.message);
                    }
                });
            } catch (error) {
                this.warn(`Failed to attach ${event} handler:`, error);
            }
        });

        this.info('Drawing event handlers setup completed');
    }

    // Safe wrapper methods for UI interactions
    safeToggleDrawingMode() {
        try {
            this.toggleDrawingMode();
        } catch (error) {
            this.error('Error in toggle drawing mode:', error);
            this.showUserError('Failed to toggle drawing mode. Please refresh the page.');
        }
    }

    safeStopDrawingMode() {
        try {
            this.stopDrawingMode();
        } catch (error) {
            this.error('Error stopping drawing mode:', error);
        }
    }

    safeClearBoundary() {
        try {
            this.clearBoundary();
        } catch (error) {
            this.error('Error clearing boundary:', error);
        }
    }

    safeConfirmBoundary() {
        try {
            this.confirmBoundary();
        } catch (error) {
            this.error('Error confirming boundary:', error);
        }
    }

    safeUseLegalBoundary() {
        try {
            this.useLegalPropertyBoundary();
        } catch (error) {
            this.error('Error using legal property boundary:', error);
            this.showUserError('Failed to use legal property boundary: ' + error.message);
        }
    }

    // Safe event handlers
    safeHandlePolygonCreated(e) {
        try {
            this.handlePolygonCreated(e);
        } catch (error) {
            this.error('Error in polygon creation handler:', error);
            this.resetDrawingState();
        }
    }

    safeHandlePolygonUpdated(e) {
        try {
            this.handlePolygonUpdated(e);
        } catch (error) {
            this.error('Error in polygon update handler:', error);
        }
    }

    safeHandlePolygonDeleted(e) {
        try {
            this.handlePolygonDeleted(e);
        } catch (error) {
            this.error('Error in polygon delete handler:', error);
        }
    }

    safeHandleModeChange(e) {
        try {
            this.handleModeChange(e);
        } catch (error) {
            this.error('Error in mode change handler:', error);
        }
    }

    enableDrawingTools() {
        const maxRetries = 10;
        let attempts = 0;

        const checkReadiness = () => {
            attempts++;
            try {
                if (this.map && this.map.isStyleLoaded() && this.draw &&
                    typeof this.draw.changeMode === 'function') {

                    // Ensure draw button is enabled and ready
                    const drawBtn = this.getElementById('drawPolygonButton', false);
                    if (drawBtn) {
                        drawBtn.disabled = false;
                        drawBtn.style.opacity = '1';
                        drawBtn.textContent = 'Draw Site Boundary';
                        drawBtn.classList.remove('active');
                    }

                    this.info('Drawing tools enabled and ready');
                    return;
                }

                if (attempts < maxRetries) {
                    setTimeout(checkReadiness, 500);
                } else {
                    this.warn('Drawing tools not ready after maximum retries');
                }
            } catch (error) {
                this.warn('Error enabling drawing tools:', error);
                if (attempts < maxRetries) {
                    setTimeout(checkReadiness, 1000);
                }
            }
        };

        setTimeout(checkReadiness, 100);
    }

    setupLegalBoundaryButtonState() {
        try {
            const legalBoundaryBtn = this.getElementById('useLegalBoundaryButton', false);
            if (!legalBoundaryBtn) {
                this.warn('Legal boundary button not found');
                return;
            }

            // Get location from project data or site data
            const siteData = window.siteData || {};
            const projectData = window.projectData || {};

            let center = siteData.center;
            if (!center && projectData.lat && projectData.lng) {
                center = { lat: projectData.lat, lng: projectData.lng };
            }

            // Default to Wellington coordinates if no location available
            if (!center || !center.lat || !center.lng) {
                center = { lat: -41.2865, lng: 174.7762 }; // Wellington default
            }

            const isInNZ = this.isLocationInNewZealand(center.lat, center.lng);

            if (isInNZ) {
                legalBoundaryBtn.disabled = false;
                legalBoundaryBtn.style.opacity = '1';
                legalBoundaryBtn.title = 'Use official property boundary from LINZ';
                this.info('Legal boundary button enabled for New Zealand location');
            } else {
                legalBoundaryBtn.disabled = true;
                legalBoundaryBtn.style.opacity = '0.5';
                legalBoundaryBtn.style.background = '#e9ecef';
                legalBoundaryBtn.style.color = '#6c757d';
                legalBoundaryBtn.title = 'Legal property boundaries are only available within New Zealand';
                this.info('Legal boundary button disabled for location outside New Zealand');
            }
        } catch (error) {
            this.error('Error setting up legal boundary button state:', error);
        }
    }

    toggleDrawingMode() {
        if (!this.validateDrawingReadiness()) {
            return;
        }

        this.info(`Toggle drawing mode - currently drawing: ${this.isDrawing}`);

        if (this.isDrawing) {
            this.stopDrawingMode();
        } else {
            this.startDrawingMode();
        }
    }

    validateDrawingReadiness() {
        if (!this.draw) {
            this.error('Drawing not available');
            this.showUserError('Drawing tools are not available. Please refresh the page.');
            return false;
        }

        if (!this.map || !this.map.isStyleLoaded()) {
            this.warn('Map not ready for drawing');
            this.showUserError('Map is still loading. Please wait a moment and try again.');
            return false;
        }

        if (typeof this.draw.changeMode !== 'function') {
            this.error('Draw control not properly initialized');
            this.showUserError('Drawing tools are not ready. Please refresh the page.');
            return false;
        }

        return true;
    }

    startDrawingMode() {
        if (!this.validateDrawingReadiness()) {
            return;
        }

        try {
            this.info('Starting drawing mode...');

            // Clear any existing state
            this.clearDrawingVisualization();
            this.drawingPoints = [];

            // Clear existing polygons safely
            this.safeDeleteAllFeatures();

            // Set drawing state
            this.isDrawing = true;
            this.updateButtonState('drawPolygonButton', 'active', 'Stop Drawing');

            // Set up drawing event listeners for live preview
            this.setupDrawingPreview();

            // Start polygon drawing mode
            this.draw.changeMode('draw_polygon');
            this.info('Drawing mode activated - click on map to start drawing polygon');

            // Verify mode change
            this.verifyModeChange();

        } catch (error) {
            this.error('Failed to start drawing mode:', error);
            this.resetDrawingState();
            this.showUserError('Failed to start drawing mode: ' + (error.message || 'Unknown error'));
        }
    }

    safeDeleteAllFeatures() {
        try {
            if (this.draw && typeof this.draw.deleteAll === 'function') {
                this.draw.deleteAll();
            }
        } catch (error) {
            this.warn('Could not clear existing features:', error);
        }
    }

    verifyModeChange() {
        setTimeout(() => {
            try {
                if (this.draw && typeof this.draw.getMode === 'function') {
                    const currentMode = this.draw.getMode();
                    if (currentMode !== 'draw_polygon') {
                        this.warn('Drawing mode may not have activated properly. Current mode:', currentMode);
                    }
                }
            } catch (error) {
                this.warn('Could not verify drawing mode:', error);
            }
        }, 100);
    }

    setupDrawingPreview() {
        // Add map click listener for adding points
        this.map.on('click', this.handleDrawingClick);

        // Add mouse move listener for live preview
        this.map.on('mousemove', this.handleDrawingMouseMove);

        // Add drawing event listeners
        this.map.on('draw.update', this.handleDrawingUpdate);
        this.map.on('draw.selectionchange', this.handleDrawingSelectionChange);

        this.info('Drawing preview listeners set up');
    }

    removeDrawingPreview() {
        try {
            this.map.off('click', this.handleDrawingClick);
            this.map.off('mousemove', this.handleDrawingMouseMove);
            this.map.off('draw.update', this.handleDrawingUpdate);
            this.map.off('draw.selectionchange', this.handleDrawingSelectionChange);
            this.info('Drawing preview listeners removed');
        } catch (error) {
            this.warn('Error removing drawing preview listeners:', error);
        }
    }

    handleDrawingClick = (e) => {
        if (!this.isDrawing) return;

        try {
            const point = [e.lngLat.lng, e.lngLat.lat];
            this.drawingPoints.push(point);

            this.info(`Drawing point ${this.drawingPoints.length} added:`, point);

            // Update the preview visualization
            this.updateDrawingPreview();

            // Add point marker
            this.addDrawingPointMarker(point, this.drawingPoints.length - 1);

        } catch (error) {
            this.error('Error handling drawing click:', error);
        }
    }

    handleDrawingMouseMove = (e) => {
        if (!this.isDrawing || this.drawingPoints.length === 0) return;

        try {
            const mousePoint = [e.lngLat.lng, e.lngLat.lat];
            this.updateLiveDrawingPreview(mousePoint);
        } catch (error) {
            // Suppress mouse move errors to avoid spam
            console.debug('Mouse move error:', error.message);
        }
    }

    handleDrawingUpdate = (e) => {
        if (!this.isDrawing) return;

        try {
            // Update our internal points array from the draw tool
            if (e.features && e.features[0] && e.features[0].geometry && e.features[0].geometry.coordinates) {
                const coords = e.features[0].geometry.coordinates[0];
                if (coords && coords.length > 0) {
                    this.drawingPoints = coords.slice(0, -1); // Remove the duplicate closing point
                    this.updateDrawingPreview();
                }
            }
        } catch (error) {
            this.warn('Error handling drawing update:', error);
        }
    }

    handleDrawingSelectionChange = (e) => {
        // Handle selection changes during drawing if needed
        this.debug('Drawing selection change:', e);
    }

    updateDrawingPreview() {
        try {
            const features = [];

            // Always show points if we have any
            if (this.drawingPoints.length >= 1) {
                // Create preview line if we have 2+ points
                if (this.drawingPoints.length >= 2) {
                    const lineFeature = {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: this.drawingPoints
                        },
                        properties: {
                            type: 'preview-line'
                        }
                    };
                    features.push(lineFeature);
                }

                // Create preview fill if we have 3+ points
                if (this.drawingPoints.length >= 3) {
                    const closedCoords = [...this.drawingPoints, this.drawingPoints[0]];
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
                this.updateSource(this.sourceIds.preview, {
                    type: 'FeatureCollection',
                    features: features
                });

                // Add dimensions for edges
                this.updateDrawingDimensions();

                this.info(`Drawing preview updated with ${features.length} features and ${this.drawingPoints.length} points`);
            } else {
                this.clearDrawingVisualization();
            }

        } catch (error) {
            this.error('Error updating drawing preview:', error);
        }
    }

    updateLiveDrawingPreview(mousePoint) {
        if (this.drawingPoints.length === 0) return;

        try {
            // Get static features first
            const staticFeatures = this.getStaticPreviewFeatures();
            const liveFeatures = [];

            // Create live preview line from last point to mouse
            if (this.drawingPoints.length >= 1) {
                const lastPoint = this.drawingPoints[this.drawingPoints.length - 1];
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
            if (this.drawingPoints.length >= 2) {
                const previewCoords = [...this.drawingPoints, mousePoint, this.drawingPoints[0]];
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
            this.updateSource(this.sourceIds.preview, {
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

        if (this.drawingPoints.length >= 2) {
            // Static line through existing points
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: this.drawingPoints
                },
                properties: {
                    type: 'preview-line'
                }
            });
        }

        // Add static polygon if we have 3+ points
        if (this.drawingPoints.length >= 3) {
            const closedCoords = [...this.drawingPoints, this.drawingPoints[0]];
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
            const existingSource = this.map.getSource(this.sourceIds.points);
            if (existingSource && existingSource._data) {
                const currentData = existingSource._data;
                currentData.features.push(pointFeature);
                this.updateSource(this.sourceIds.points, currentData);
            } else {
                this.updateSource(this.sourceIds.points, {
                    type: 'FeatureCollection',
                    features: [pointFeature]
                });
            }

        } catch (error) {
            this.error('Error adding drawing point marker:', error);
        }
    }

    updateDrawingDimensions() {
        if (this.drawingPoints.length < 2) return;

        try {
            const dimensionFeatures = [];

            for (let i = 0; i < this.drawingPoints.length - 1; i++) {
                const start = this.drawingPoints[i];
                const end = this.drawingPoints[i + 1];
                const distance = this.calculateDistance(start[0], start[1], end[0], end[1]);
                const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

                dimensionFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: midpoint },
                    properties: {
                        distance: `${distance.toFixed(1)}m`,
                        type: 'drawing-dimension'
                    }
                });
            }

            this.updateSource(this.sourceIds.dimensions, {
                type: 'FeatureCollection',
                features: dimensionFeatures
            });

        } catch (error) {
            this.error('Error updating drawing dimensions:', error);
        }
    }

    resetDrawingState() {
        this.isDrawing = false;
        this.removeDrawingPreview();
        this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');
        this.clearDrawingVisualization();
    }

    stopDrawingMode() {
        if (!this.draw) return;

        try {
            this.isDrawing = false;
            this.draw.changeMode('simple_select');
            this.clearDrawingVisualization();
            this.removeDrawingPreview();
            this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');
            this.info('Drawing mode stopped');
        } catch (error) {
            this.error('Failed to stop drawing mode:', error);
        }
    }

    handleModeChange(e) {
        if (!e || typeof e.mode !== 'string') {
            this.warn('Invalid mode change event');
            return;
        }

        const wasDrawing = this.isDrawing;
        this.isDrawing = e.mode === 'draw_polygon' || e.mode === 'DRAW_POLYGON';

        if (this.isDrawing && !wasDrawing) {
            this.info('Polygon drawing mode activated');
            this.updateButtonState('drawPolygonButton', 'active', 'Stop Drawing');
        } else if (!this.isDrawing && wasDrawing) {
            this.info('Polygon drawing mode deactivated');
            this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');
        }
    }

    clearDrawingVisualization() {
        const emptyFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        [this.sourceIds.preview, this.sourceIds.points, this.sourceIds.dimensions].forEach(sourceId => {
            this.updateSource(sourceId, emptyFeatureCollection);
        });

        this.drawingPoints = [];
    }

    handlePolygonCreated(e) {
        this.info('Polygon creation event received');

        try {
            // Validate event
            this.validatePolygonEvent(e);

            // Process coordinates
            const coordinates = this.processPolygonCoordinates(e.features[0]);

            // Create polygon feature
            const feature = this.createPolygonFeature(coordinates);
            this.sitePolygon = feature;

            // Calculate metrics
            const metrics = this.calculatePolygonMetrics(coordinates);
            this.polygonEdges = metrics.edges;

            // Update UI
            this.updateUIAfterCreation(coordinates, metrics);

            // Emit events
            this.emitBoundaryCreatedEvent(coordinates, metrics);

            this.info(`Site boundary created successfully - Area: ${metrics.area.toFixed(2)} m², Points: ${coordinates.length - 1}`);

        } catch (error) {
            this.handlePolygonCreationError(error);
        }
    }

    validatePolygonEvent(e) {
        if (!e || !e.features || !e.features[0]) {
            throw new Error('Invalid polygon creation event');
        }

        const feature = e.features[0];
        if (!feature.geometry || !feature.geometry.coordinates || !feature.geometry.coordinates[0]) {
            throw new Error('Invalid polygon geometry');
        }

        const coordinates = feature.geometry.coordinates[0];
        if (coordinates.length < this.config.minPolygonPoints + 1) { // +1 for closed polygon
            throw new Error(`Polygon must have at least ${this.config.minPolygonPoints} points`);
        }
    }

    processPolygonCoordinates(feature) {
        const coordinates = feature.geometry.coordinates[0];
        this.info(`Processing ${coordinates.length} coordinate points`);

        // Validate and clean coordinates
        const cleanCoords = this.cleanCoordinates(coordinates);

        if (cleanCoords.length < this.config.minPolygonPoints) {
            throw new Error('Not enough valid coordinates for polygon');
        }

        // Ensure polygon is closed
        return this.ensureClosedPolygon(cleanCoords);
    }

    cleanCoordinates(coordinates) {
        const cleanCoords = [];

        for (let i = 0; i < coordinates.length; i++) {
            const coord = coordinates[i];

            if (!this.isValidCoordinateArray(coord)) {
                this.warn(`Invalid coordinate at index ${i}:`, coord);
                continue;
            }

            const [lng, lat] = this.parseCoordinate(coord);

            if (!this.isValidCoordinateRange(lng, lat)) {
                this.warn(`Invalid coordinate range at index ${i}:`, coord);
                continue;
            }

            cleanCoords.push([lng, lat]);
        }

        return cleanCoords;
    }

    isValidCoordinateArray(coord) {
        return Array.isArray(coord) && coord.length === 2;
    }

    parseCoordinate(coord) {
        const lng = parseFloat(coord[0]);
        const lat = parseFloat(coord[1]);

        if (isNaN(lng) || isNaN(lat)) {
            throw new Error(`NaN coordinate: ${coord}`);
        }

        return [lng, lat];
    }

    isValidCoordinateRange(lng, lat) {
        return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
    }

    ensureClosedPolygon(coordinates) {
        const firstCoord = coordinates[0];
        const lastCoord = coordinates[coordinates.length - 1];

        if (!this.pointsAreEqual(firstCoord, lastCoord)) {
            coordinates.push([...firstCoord]);
        }

        return coordinates;
    }

    pointsAreEqual(p1, p2, tolerance = null) {
        tolerance = tolerance || this.config.coordinateTolerance;
        return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
    }

    createPolygonFeature(coordinates) {
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            }
        };
    }

    calculatePolygonMetrics(coordinates) {
        const area = this.calculatePolygonArea(coordinates);
        const perimeter = this.calculatePolygonPerimeter(coordinates);
        const edges = this.calculatePolygonEdges(coordinates);

        if (isNaN(area) || area <= 0) {
            throw new Error('Invalid polygon area calculated');
        }

        return { area, perimeter, edges };
    }

    updateUIAfterCreation(coordinates, metrics) {
        this.clearDrawingVisualization();
        this.updateBoundaryDisplay(metrics.area, metrics.perimeter, coordinates.length - 1);
        this.updateButtonStates(true);
        this.showFinalDimensions(coordinates);
        this.showFinalBoundary(coordinates);
        this.resetDrawingState();

        // Safely change draw mode
        setTimeout(() => {
            try {
                if (this.draw && this.draw.changeMode) {
                    this.draw.changeMode('simple_select');
                }
            } catch (error) {
                this.warn('Could not change draw mode:', error);
            }
        }, 100);
    }

    emitBoundaryCreatedEvent(coordinates, metrics) {
        const coordsForCenter = coordinates.slice(0, -1); // Exclude closing point
        const centerLng = coordsForCenter.reduce((sum, coord) => sum + coord[0], 0) / coordsForCenter.length;
        const centerLat = coordsForCenter.reduce((sum, coord) => sum + coord[1], 0) / coordsForCenter.length;

        this.emit('site-boundary-created', {
            coordinates: coordinates,
            area: metrics.area,
            area_m2: metrics.area,
            perimeter: metrics.perimeter,
            edges: metrics.edges,
            center: {lng: centerLng, lat: centerLat },
            center_lng: centerLng,
            center_lat: centerLat,
            type: 'residential',
            terrainBounds: this.calculateTerrainBounds(coordinates)
        });
    }

    handlePolygonCreationError(error) {
        this.error('Error handling polygon creation:', error);
        this.resetDrawingState();
        this.clearDrawingVisualization();
        this.safeDeleteAllFeatures();
        this.showUserError('Failed to create site boundary: ' + error.message + '\n\nPlease try drawing the polygon again.');
    }

    calculatePolygonArea(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;

        // Try Turf.js first if available
        if (this.tryTurfCalculation) {
            const turfArea = this.tryTurfCalculation(coordinates);
            if (turfArea > 0) return turfArea;
        }

        // Fallback to manual calculation
        return this.calculatePolygonAreaFallback(coordinates);
    }

    tryTurfCalculation(coordinates) {
        try {
            if (typeof turf !== 'undefined' && turf.area && turf.polygon) {
                const polygon = turf.polygon([coordinates]);
                return turf.area(polygon);
            }
        } catch (error) {
            this.warn('Error calculating area with Turf.js:', error);
        }
        return 0;
    }

    calculatePolygonAreaFallback(coordinates) {
        try {
            // Use shoelace formula
            let area = 0;
            const coords = this.normalizeCoordinates(coordinates);

            for (let i = 0; i < coords.length; i++) {
                const j = (i + 1) % coords.length;
                const [xi, yi] = coords[i];
                const [xj, yj] = coords[j];

                if (isNaN(xi) || isNaN(yi) || isNaN(xj) || isNaN(yj)) {
                    continue;
                }

                area += xi * yj - xj * yi;
            }

            area = Math.abs(area) / 2;

            // Convert from degrees² to m² (approximate for NZ)
            return area * 111320 * 111320;
        } catch (error) {
            this.error('Error in fallback area calculation:', error);
            return 0;
        }
    }

    calculatePolygonPerimeter(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;

        let perimeter = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
            const current = coordinates[i];
            const next = coordinates[i + 1];
            perimeter += this.calculateDistance(current[0], current[1], next[0], next[1]);
        }
        return perimeter;
    }

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

    calculatePolygonEdges(coordinates) {
        const edges = [];
        if (!coordinates || coordinates.length < 3) return edges;

        try {
            const coordsToProcess = this.normalizeCoordinates(coordinates);

            for (let i = 0; i < coordsToProcess.length; i++) {
                const start = coordsToProcess[i];
                const end = coordsToProcess[(i + 1) % coordsToProcess.length];

                if (this.isValidCoordinate(start) && this.isValidCoordinate(end)) {
                    edges.push({
                        index: i,
                        start: start,
                        end: end,
                        midpoint: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
                    });
                }
            }

            return edges;
        } catch (error) {
            this.error('Error calculating polygon edges:', error);
            return edges;
        }
    }

    normalizeCoordinates(coordinates) {
        if (coordinates.length > 3 &&
            this.pointsAreEqual(coordinates[0], coordinates[coordinates.length - 1])) {
            return coordinates.slice(0, -1);
        }
        return coordinates;
    }

    isValidCoordinate(coord) {
        return coord && coord.length >= 2 &&
               typeof coord[0] === 'number' &&
               typeof coord[1] === 'number';
    }

    calculateTerrainBounds(coordinates) {
        if (!coordinates || coordinates.length === 0) return null;

        const lngs = coordinates.map(coord => coord[0]);
        const lats = coordinates.map(coord => coord[1]);

        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);

        const buffer = 0.00045; // Approximate 50m in degrees

        return {
            bounds: {
                north: maxLat + buffer,
                south: minLat - buffer,
                east: maxLng + buffer,
                west: minLng - buffer
            },
            center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
            zoom: this.calculateOptimalZoom(maxLng - minLng, maxLat - minLat),
            width: maxLng - minLng,
            height: maxLat - minLat,
            timestamp: new Date().toISOString()
        };
    }

    calculateOptimalZoom(width, height) {
        const maxDimension = Math.max(width, height);
        if (maxDimension > 0.01) return 15;
        if (maxDimension > 0.005) return 16;
        if (maxDimension > 0.002) return 17;
        if (maxDimension > 0.001) return 18;
        return 19;
    }

    updateButtonState(buttonId, state, text = null) {
        try {
            const button = this.getElementById(buttonId, false);
            if (!button) return;

            button.classList.toggle('active', state === 'active');

            if (text) {
                button.textContent = text;
            }

            // Only disable draw button if map/draw are not ready, but keep it enabled otherwise
            if (buttonId === 'drawPolygonButton') {
                const isReady = this.map && this.draw;
                button.disabled = !isReady;
                button.style.opacity = isReady ? '1' : '0.5';
            }
            // Don't modify other buttons' disabled state here - they have their own logic
        } catch (error) {
            console.debug('Button update error:', error.message);
        }
    }

    updateBoundaryDisplay(area, perimeter, pointCount) {
        this.setElementDisplay('boundaryInfoDisplay', 'block');
        this.setElementText('boundaryAreaDisplay', `${area.toFixed(2)} m²`);
        this.setElementText('boundaryPerimeterDisplay', `${perimeter.toFixed(2)} m`);
        this.setElementText('boundaryPointsDisplay', pointCount.toString());
    }

    updateButtonStates(polygonCreated = false, boundaryExists = false) {
        const buttons = {
            draw: this.getElementById('drawPolygonButton', false),
            confirm: this.getElementById('confirmBoundaryButton', false),
            clear: this.getElementById('clearBoundaryButton', false),
            clear2: this.getElementById('clearBoundaryButton2', false)
        };

        if (polygonCreated || boundaryExists) {
            if (buttons.confirm) {
                buttons.confirm.style.display = boundaryExists ? 'none' : 'inline-block';
            }
            if (buttons.clear) buttons.clear.style.display = 'inline-block';
            if (buttons.clear2) {
                buttons.clear2.style.display = boundaryExists ? 'inline-block' : 'none';
            }
            if (buttons.draw && boundaryExists) {
                buttons.draw.style.display = 'none';
            }
        } else {
            if (buttons.confirm) buttons.confirm.style.display = 'none';
            if (buttons.clear) buttons.clear.style.display = 'none';
            if (buttons.clear2) buttons.clear2.style.display = 'none';
            if (buttons.draw) buttons.draw.style.display = 'inline-block';
        }
    }

    showFinalDimensions(coordinates) {
        const dimensionFeatures = [];

        for (let i = 0; i < coordinates.length - 1; i++) {
            const start = coordinates[i];
            const end = coordinates[i + 1];
            const distance = this.calculateDistance(start[0], start[1], end[0], end[1]);
            const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

            dimensionFeatures.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: midpoint },
                properties: {
                    distance: `${distance.toFixed(1)}m`,
                    type: 'final-dimension'
                }
            });
        }

        this.updateSource(this.sourceIds.dimensions, {
            type: 'FeatureCollection',
            features: dimensionFeatures
        });
    }

    showFinalBoundary(coordinates) {
        try {
            // Create the final boundary polygon feature
            const boundaryFeature = {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                },
                properties: {
                    type: 'site-boundary'
                }
            };

            // Update the final boundary source
            this.updateSource(this.sourceIds.final, {
                type: 'FeatureCollection',
                features: [boundaryFeature]
            });

            // Ensure the final boundary layers exist and are visible
            this.ensureFinalBoundaryLayers();

            this.info('Final site boundary displayed on map');
        } catch (error) {
            this.error('Error showing final boundary:', error);
        }
    }

    ensureFinalBoundaryLayers() {
        const config = window.SiteInspectorConfig;
        if (!config) {
            this.error('SiteInspectorConfig not available for final boundary layers');
            return;
        }

        // Add final boundary fill layer if it doesn't exist
        if (!this.map.getLayer(this.layerIds.finalFill)) {
            try {
                this.map.addLayer({
                    id: this.layerIds.finalFill,
                    type: 'fill',
                    source: this.sourceIds.final,
                    paint: {
                        'fill-color': '#547bf7',
                        'fill-opacity': 0.3
                    }
                });
                this.info('Added final boundary fill layer');
            } catch (error) {
                this.warn('Could not add final fill layer:', error);
            }
        }

        // Add final boundary stroke layer if it doesn't exist
        if (!this.map.getLayer(this.layerIds.finalStroke)) {
            try {
                this.map.addLayer({
                    id: this.layerIds.finalStroke,
                    type: 'line',
                    source: this.sourceIds.final,
                    paint: {
                        'line-color': '#547bf7',
                        'line-width': 3,
                        'line-opacity': 0.8
                    }
                });
                this.info('Added final boundary stroke layer');
            } catch (error) {
                this.warn('Could not add final stroke layer:', error);
            }
        }

        // Ensure layers are visible
        try {
            this.map.setLayoutProperty(this.layerIds.finalFill, 'visibility', 'visible');
            this.map.setLayoutProperty(this.layerIds.finalStroke, 'visibility', 'visible');
            this.info('Final boundary layers made visible');
        } catch (error) {
            this.warn('Could not set layer visibility:', error);
        }
    }

    confirmBoundary() {
        if (!this.sitePolygon) {
            this.warn('No boundary to confirm');
            return;
        }

        this.isLocked = true;

        // Emit boundary-applied event to trigger UI workflow
        window.eventBus.emit('boundary-applied');
        this.info('Site boundary confirmed and locked - boundary-applied event emitted');

        this.updateButtonStates(false, true);

        // Also update UI panel manager directly as fallback
        setTimeout(() => {
            const uiManager = window.siteInspectorCore?.uiPanelManager;
            if (uiManager) {
                uiManager.updateBoundaryAppliedState();
            }
        }, 100);
    }

    clearBoundary() {
        this.info('Clearing site boundary...');

        try {
            // Clear drawing state
            this.resetDrawingState();

            // Clear polygon data
            this.sitePolygon = null;
            this.polygonEdges = [];
            this.buildableAreaData = null;
            this.isLocked = false;

            // Clear all visual elements
            this.clearAllVisualizationLayers();

            // Reset UI and ensure draw button is enabled
            this.updateButtonStates(false, false);
            this.setElementDisplay('boundaryInfoDisplay', 'none');

            // Explicitly re-enable the draw button after clearing
            const drawBtn = this.getElementById('drawPolygonButton', false);
            if (drawBtn && this.map && this.draw) {
                drawBtn.disabled = false;
                drawBtn.style.opacity = '1';
                drawBtn.textContent = 'Draw Site Boundary';
                drawBtn.classList.remove('active');
            }

            // Emit clearing events
            this.emit('site-boundary-deleted');
            this.emit('clear-all-dependent-features');

            this.info('Site boundary cleared successfully');

        } catch (error) {
            this.error('Error clearing site boundary:', error);
        }
    }

    clearAllVisualizationLayers() {
        this.clearDrawingVisualization();
        this.clearBuildableArea();
        this.clearBoundaryLayers();
    }

    clearBoundaryLayers() {
        // Clear final boundary visualization
        const emptyFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        this.updateSource(this.sourceIds.final, emptyFeatureCollection);

        const boundaryLayers = ['boundary-dimension-labels', 'site-dimension-labels', 'site-dimensions'];
        const boundarySources = ['boundary-dimensions', 'site-dimensions'];

        boundaryLayers.forEach(layerId => {
            if (this.map.getLayer && this.map.getLayer(layerId)) {
                try {
                    this.map.removeLayer(layerId);
                    this.info(`Removed boundary layer: ${layerId}`);
                } catch (error) {
                    this.warn(`Failed to remove layer ${layerId}:`, error);
                }
            }
        });

        boundarySources.forEach(sourceId => {
            if (this.map.getSource && this.map.getSource(sourceId)) {
                try {
                    this.map.removeSource(sourceId);
                    this.info(`Removed boundary source: ${sourceId}`);
                } catch (error) {
                    this.warn(`Failed to remove source ${sourceId}:`, error);
                }
            }
        });
    }

    resetBoundaryState() {
        this.sitePolygon = null;
        this.polygonEdges = [];
        this.buildableAreaData = null;
        this.isLocked = false;

        if (this.draw) {
            try {
                this.draw.deleteAll();
                this.draw.changeMode('simple_select');
            } catch (error) {
                this.warn('Error resetting draw state:', error);
            }
        }
    }

    updateUI() {
        this.setElementDisplay('boundaryInfoDisplay', 'none');
        this.updateButtonStates(false, false);

        // Ensure draw button is enabled and ready for new boundary
        const drawBtn = this.getElementById('drawPolygonButton', false);
        if (drawBtn && this.map && this.draw) {
            drawBtn.disabled = false;
            drawBtn.style.opacity = '1';
            drawBtn.textContent = 'Draw Site Boundary';
            drawBtn.classList.remove('active');
        }
    }

    emitClearingEvents() {
        this.emit('site-boundary-deleted');
        this.emit('clear-all-dependent-features');

        setTimeout(() => {
            this.emit('clear-all-dependent-features');
        }, 100);
    }

    // Buildable Area Methods
    async calculateBuildableArea(setbackData) {
        this.info('Calculating buildable area with data:', setbackData);

        try {
            if (!this.hasSiteBoundary()) {
                throw new Error('No site boundary available for calculation');
            }

            const result = await this.performBuildableAreaCalculation(setbackData);

            if (result.buildable_coords && result.buildable_coords.length > 0) {
                this.buildableAreaData = result;
                this.updateBuildableAreaDisplay(result, false); // Pass false for isPreview
                await this.saveBuildableAreaToProject(result, setbackData);

                this.info('Buildable area calculated successfully with', result.buildable_coords.length, 'coordinates');
                this.emit('buildable-area-calculated', result);
                return result;
            } else {
                throw new Error(result.error || 'No buildable area calculated - result may be empty');
            }

        } catch (error) {
            this.error('Buildable area calculation failed:', error);
            throw error;
        }
    }

    async performBuildableAreaCalculation(setbackData) {
        const siteCoords = this.sitePolygon.geometry.coordinates[0];
        const edgeClassifications = this.createEdgeClassifications(setbackData);
        const requirements = {
            front_setback: setbackData.frontSetback,
            side_setback: setbackData.sideSetback,
            rear_setback: setbackData.backSetback
        };

        const response = await fetch('/api/calculate-buildable-area', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                site_coords: siteCoords,
                frontage: 'north',
                requirements: requirements,
                edge_classifications: edgeClassifications
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async calculateBuildableAreaPreview(data) {
        try {
            this.info('Starting buildable area preview calculation');

            if (!this.sitePolygon || !this.sitePolygon.geometry || !this.sitePolygon.geometry.coordinates) {
                this.warn('No site boundary available for buildable area calculation');
                return;
            }

            // Get site coordinates
            const siteCoords = this.sitePolygon.geometry.coordinates[0];

            // Prepare calculation data
            const calculationData = {
                site_coords: siteCoords,
                requirements: {
                    front_setback: data.frontSetback || 4.5,
                    side_setback: data.sideSetback || 1.5,
                    rear_setback: data.backSetback || 3.5
                },
                frontage: data.frontage || 'north',
                edge_classifications: this.createEdgeClassifications(data.selectedEdges, siteCoords)
            };

            this.info('Preview calculation data prepared:', calculationData);

            // Calculate buildable area
            const response = await fetch('/api/calculate-buildable-area', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(calculationData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            this.info('Buildable area preview calculation result:', result);

            // Update buildable area display with the actual result data
            if (result && result.buildable_coords && result.buildable_coords.length > 0) {
                this.updateBuildableAreaDisplay(result, true);
            } else {
                this.info('No buildable coordinates in result, clearing display');
                this.updateBuildableAreaDisplay(null, true);
            }

            this.info('Buildable area preview completed successfully');

        } catch (error) {
            this.error('Error calculating buildable area preview:', error);
        }
    }


    createEdgeClassifications(setbackData) {
        const edgeClassifications = [];

        if (setbackData.front && setbackData.back) {
            this.polygonEdges.forEach((edge, index) => {
                let type = 'side';
                let setback = parseFloat(setbackData.sideSetback) || 0;

                if (index === setbackData.front.index) {
                    type = 'front';
                    setback = parseFloat(setbackData.frontSetback) || 0;
                } else if (index === setbackData.back.index) {
                    type = 'back';
                    setback = parseFloat(setbackData.backSetback) || 0;
                }

                edgeClassifications.push({
                    index: index,
                    type: type,
                    setback: setback
                });
            });
        } else {
            this.polygonEdges.forEach((edge, index) => {
                edgeClassifications.push({
                    index: index,
                    type: 'side',
                    setback: parseFloat(setbackData.sideSetback) || 0
                });
            });
        }

        return edgeClassifications;
    }

    updateBuildableAreaDisplay(result, isPreview = false) {
        this.info('Updating buildable area display with data:', result);

        if (!result || !result.buildable_coords || result.buildable_coords.length === 0) {
            this.info('No buildable data provided');
            this.clearBuildableAreaDisplay();
            return;
        }

        try {
            // Convert coordinates for display
            let coordinates = result.buildable_coords.map(coord => {
                if (Array.isArray(coord) && coord.length >= 2) {
                    // Backend returns [lat, lng], Mapbox needs [lng, lat]
                    return [coord[1], coord[0]];
                }
                return coord;
            });

            // Ensure polygon is closed
            if (coordinates.length > 0) {
                const firstCoord = coordinates[0];
                const lastCoord = coordinates[coordinates.length - 1];
                if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                    coordinates.push([...firstCoord]);
                }
            }

            // Display the buildable area
            this.displayBuildableAreaPolygon(coordinates, isPreview);

        } catch (error) {
            this.error('Error updating buildable area display:', error);
        }
    }

    displayBuildableAreaPolygon(coordinates, isPreview = false) {
        try {
            // Remove existing buildable area layers
            const layersToRemove = ['buildable-area-fill', 'buildable-area-stroke'];
            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            if (this.map.getSource('buildable-area')) {
                this.map.removeSource('buildable-area');
            }

            if (coordinates && coordinates.length > 0) {
                // Add source
                this.map.addSource('buildable-area', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [coordinates]
                        },
                        properties: {
                            type: 'buildable-area',
                            is_preview: isPreview
                        }
                    }
                });

                // Different styling for preview vs confirmed
                const fillColor = isPreview ? '#002040' : '#002040';
                const fillOpacity = isPreview ? 0.2 : 0.4;
                const strokeColor = isPreview ? '#002040' : '#002040';
                const strokeOpacity = isPreview ? 0.7 : 0.8;
                const strokeWidth = isPreview ? 2 : 3;

                // Add fill layer
                this.map.addLayer({
                    id: 'buildable-area-fill',
                    type: 'fill',
                    source: 'buildable-area',
                    layout: {},
                    paint: {
                        'fill-color': fillColor,
                        'fill-opacity': fillOpacity
                    }
                });

                // Add stroke layer
                this.map.addLayer({
                    id: 'buildable-area-stroke',
                    type: 'line',
                    source: 'buildable-area',
                    layout: {},
                    paint: {
                        'line-color': strokeColor,
                        'line-width': strokeWidth,
                        'line-opacity': strokeOpacity
                    }
                });

                if (!isPreview) {
                    this.info(`Buildable area displayed on map with ${coordinates.length - 1} vertices`);
                }
            }
        } catch (error) {
            this.error('Error displaying buildable area polygon:', error);
        }
    }


    clearBuildableAreaDisplay() {
        try {
            // Clear the buildable area source
            const emptyFeatureCollection = {
                type: 'FeatureCollection',
                features: []
            };
            this.updateSource(this.sourceIds.buildableArea, emptyFeatureCollection);
            console.log('[SiteBoundaryCore] INFO:', 'Buildable area display cleared');
        } catch (error) {
            console.error('[SiteBoundaryCore] ERROR:', 'Error clearing buildable area display:', error);
        }
    }

    updateMapLegend() {
        // Update legend to show buildable area if needed
        try {
            const siteInspectorCore = window.siteInspectorCore;
            if (siteInspectorCore && siteInspectorCore.updateBuildableAreaLegend) {
                siteInspectorCore.updateBuildableAreaLegend(true);
            }
        } catch (error) {
            console.debug('[SiteBoundaryCore] DEBUG:', 'Could not update legend:', error.message);
        }
    }

    clearBuildableArea() {
        const emptyFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        this.updateSource(this.sourceIds.buildableArea, emptyFeatureCollection);
        this.buildableAreaData = null;
    }

    async saveBuildableAreaToProject(result, setbackData) {
        try {
            const projectId = this.getProjectIdFromUrl();
            if (!projectId) {
                this.warn('No project ID found, cannot save buildable area');
                return;
            }

            const snapshotData = this.createSnapshotData(result, setbackData);
            await this.postSnapshotData(projectId, snapshotData);

        } catch (error) {
            this.error('Error saving buildable area:', error);
        }
    }

    createSnapshotData(result, setbackData) {
        const terrainBounds = this.captureTerrainBounds();
        const siteCoords = this.sitePolygon.geometry.coordinates[0];
        const siteArea = this.calculatePolygonArea(siteCoords);

        return {
            buildable_coords: result.buildable_coords,
            buildable_area_m2: result.buildable_area_m2,
            site_area_m2: result.site_area_m2,
            coverage_ratio: result.coverage_ratio,
            front_setback: setbackData.frontSetback,
            rear_setback: setbackData.backSetback,
            side_setback: setbackData.sideSetback,
            height_limit: setbackData.heightLimit,
            selected_edges: setbackData.selectedEdges,
            calculation_method: result.calculation_method,
            terrain_bounds: terrainBounds,
            site_coords: siteCoords,
            site_area_calculated: siteArea,
            timestamp: new Date().toISOString()
        };
    }

    async postSnapshotData(projectId, snapshotData) {
        const response = await fetch(`/api/project/${projectId}/snapshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                snapshot_type: 'buildable_area',
                snapshot_data: JSON.stringify(snapshotData)
            })
        });

        const data = await response.json();

        if (!data.success) {
            this.error('Failed to save buildable area', data.error);
        } else {
            this.info('Buildable area saved successfully to project', projectId);
        }
    }

    captureTerrainBounds() {
        if (!this.map) {
            this.warn('Map not available for terrain bounds capture');
            return null;
        }

        try {
            const bounds = this.map.getBounds();
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();

            return {
                bounds: {
                    north: bounds.getNorth(),
                    south: bounds.getSouth(),
                    east: bounds.getEast(),
                    west: bounds.getWest()
                },
                center: [center.lng, center.lat],
                zoom: zoom,
                width: bounds.getEast() - bounds.getWest(),
                height: bounds.getNorth() - bounds.getSouth(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.error('Error capturing terrain bounds:', error);
            return null;
        }
    }

    // Event handlers for polygon operations
    handlePolygonUpdated(e) {
        this.handlePolygonCreated(e);
    }

    handlePolygonDeleted(e) {
        this.clearBoundary();
    }

    // Load existing boundary
    async loadExistingSiteBoundary() {
        try {
            const projectId = this.getProjectIdFromUrl();
            if (!projectId) {
                this.info('No project ID found for boundary loading');
                return;
            }

            const response = await fetch(`/api/project/${projectId}/snapshot`);
            if (!response.ok) {
                this.info('No existing snapshots found');
                return;
            }

            const data = await response.json();
            if (data.success && data.snapshot && data.snapshot.snapshot_data) {
                const snapshotData = JSON.parse(data.snapshot.snapshot_data);

                if (snapshotData.site_coords && snapshotData.site_coords.length > 0) {
                    this.loadBoundaryFromCoordinates(snapshotData.site_coords);
                    this.info('Site boundary loaded from project snapshot');
                }
            }
        } catch (error) {
            this.warn('Failed to load existing boundary:', error);
        }
    }

    loadBoundaryFromCoordinates(coordinates) {
        if (!this.draw || !coordinates || coordinates.length < 3) {
            return;
        }

        try {
            const polygon = this.createPolygonFeature(coordinates);
            this.draw.add(polygon);
            this.sitePolygon = polygon;

            const metrics = this.calculatePolygonMetrics(coordinates);
            this.polygonEdges = metrics.edges;

            this.updateBoundaryDisplay(metrics.area, metrics.perimeter, coordinates.length - 1);
            this.updateButtonStates(false, true);
            this.showFinalBoundary(coordinates);
            this.showFinalDimensions(coordinates);
            this.isLocked = true;

            this.emitBoundaryLoadedEvent(coordinates, metrics);
            this.info('Site boundary loaded from coordinates');

        } catch (error) {
            this.error('Error loading boundary from coordinates:', error);
        }
    }

    emitBoundaryLoadedEvent(coordinates, metrics) {
        const centerLng = coordinates.reduce((sum, coord) => sum + coord[0], 0) / coordinates.length;
        const centerLat = coordinates.reduce((sum, coord) => sum + coord[1], 0) / coordinates.length;

        this.emit('site-boundary-loaded', {
            coordinates: coordinates,
            area: metrics.area,
            area_m2: metrics.area,
            perimeter: metrics.perimeter,
            edges: metrics.edges,
            center: {lng: centerLng, lat: centerLat },
            center_lng: centerLng,
            center_lat: centerLat,
            type: 'residential',
            terrainBounds: this.calculateTerrainBounds(coordinates)
        });
    }

    getProjectIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        let projectId = urlParams.get('project_id') || urlParams.get('project');

        if (projectId && projectId.includes('?')) {
            projectId = projectId.split('?')[0];
        }

        if (projectId) {
            projectId = String(projectId).trim();
            if (!/^\d+$/.test(projectId)) {
                return null;
            }
        }

        return projectId;
    }

    // Utility method for showing user errors
    showUserError(message) {
        if (typeof alert !== 'undefined') {
            alert(message);
        }
        this.error('User error:', message);
    }

    async useLegalPropertyBoundary() {
        try {
            this.info('Using legal property boundary...');

            // Check if button should be enabled
            const legalBoundaryBtn = this.getElementById('useLegalBoundaryButton', false);
            if (legalBoundaryBtn && legalBoundaryBtn.disabled) {
                throw new Error('Legal property boundaries are not available for this location.');
            }

            // Get project data to determine if we're in New Zealand
            const siteData = window.siteData || {};
            const projectData = window.projectData || {};

            // Check if we have center coordinates
            let center = siteData.center;
            if (!center && projectData.lat && projectData.lng) {
                center = { lat: projectData.lat, lng: projectData.lng };
            }

            if (!center || !center.lat || !center.lng) {
                throw new Error('Location not available. Please ensure project location is set.');
            }

            // Check if location is in New Zealand (rough bounds check)
            const isInNZ = this.isLocationInNewZealand(center.lat, center.lng);
            if (!isInNZ) {
                throw new Error('Legal property boundaries are only available within New Zealand.');
            }

            // Show loading state
            this.updateButtonState('useLegalBoundaryButton', 'active', 'Loading Property Boundary...');

            // Fetch property boundaries
            const response = await fetch('/api/property-boundaries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: center.lat,
                    lng: center.lng
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch property boundaries: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || 'Failed to retrieve property boundaries');
            }

            if (!data.containing_property || !data.containing_property.geometry) {
                throw new Error('No containing property found for this location');
            }

            // Extract coordinates from the containing property
            const geometry = data.containing_property.geometry;
            let coordinates;

            if (geometry.type === 'Polygon') {
                coordinates = geometry.coordinates[0];
            } else if (geometry.type === 'MultiPolygon') {
                // Use the largest polygon from MultiPolygon
                const polygons = geometry.coordinates;
                const largestPolygon = polygons.reduce((largest, current) => {
                    return current[0].length > largest[0].length ? current : largest;
                });
                coordinates = largestPolygon[0];
            } else {
                throw new Error('Invalid property geometry type: ' + geometry.type);
            }

            if (!coordinates || coordinates.length < 4) {
                throw new Error('Invalid property boundary coordinates');
            }

            // Process and validate coordinates
            const processedCoordinates = this.processLegalBoundaryCoordinates(coordinates);

            // Create polygon from legal boundary
            this.createPolygonFromLegalBoundary(processedCoordinates, data.containing_property);

            this.info('Legal property boundary applied successfully');

        } catch (error) {
            this.error('Error using legal property boundary:', error);
            this.updateButtonState('useLegalBoundaryButton', 'inactive', 'Use Legal Property Boundary');
            throw error;
        }
    }

    isLocationInNewZealand(lat, lng) {
        // New Zealand bounds (approximate)
        const nzBounds = {
            north: -34.0,
            south: -47.5,
            east: 179.0,
            west: 166.0
        };

        return lat >= nzBounds.south && lat <= nzBounds.north &&
               lng >= nzBounds.west && lng <= nzBounds.east;
    }

    processLegalBoundaryCoordinates(coordinates) {
        const processedCoords = [];

        for (let i = 0; i < coordinates.length; i++) {
            const coord = coordinates[i];

            if (!Array.isArray(coord) || coord.length < 2) {
                this.warn(`Skipping invalid coordinate at index ${i}:`, coord);
                continue;
            }

            const lng = parseFloat(coord[0]);
            const lat = parseFloat(coord[1]);

            if (isNaN(lng) || isNaN(lat)) {
                this.warn(`Skipping NaN coordinate at index ${i}:`, coord);
                continue;
            }

            if (!this.isValidCoordinateRange(lng, lat)) {
                this.warn(`Skipping out-of-range coordinate at index ${i}:`, coord);
                continue;
            }

            processedCoords.push([lng, lat]);
        }

        if (processedCoords.length < 3) {
            throw new Error('Not enough valid coordinates for legal boundary polygon');
        }

        // Ensure polygon is closed
        const firstCoord = processedCoords[0];
        const lastCoord = processedCoords[processedCoords.length - 1];
        if (!this.pointsAreEqual(firstCoord, lastCoord)) {
            processedCoords.push([...firstCoord]);
        }

        return processedCoords;
    }

    createPolygonFromLegalBoundary(coordinates, propertyInfo) {
        try {
            // Clear any existing drawing state
            this.clearDrawingVisualization();
            this.safeDeleteAllFeatures();

            // Create polygon feature
            const feature = this.createPolygonFeature(coordinates);
            this.sitePolygon = feature;

            // Calculate metrics
            const metrics = this.calculatePolygonMetrics(coordinates);
            this.polygonEdges = metrics.edges;

            // Update UI
            this.updateUIAfterCreation(coordinates, metrics);
            this.updateButtonState('useLegalBoundaryButton', 'inactive', 'Legal Boundary Applied ✓');
            this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');

            // Show property information
            const propertyTitle = propertyInfo.title || 'Legal Property Boundary';
            this.info(`Legal property boundary applied: ${propertyTitle}`);

            // Emit events
            this.emitBoundaryCreatedEvent(coordinates, metrics);

            // Auto-confirm the boundary since it's from official records
            setTimeout(() => {
                this.confirmBoundary();
            }, 500);

        } catch (error) {
            this.error('Error creating polygon from legal boundary:', error);
            throw error;
        }
    }

    // Public API methods
    getPolygonEdges() {
        return this.polygonEdges;
    }

    getSitePolygon() {
        return this.sitePolygon;
    }

    isDrawingActive() {
        return this.isDrawing;
    }

    getBoundaryMetrics() {
        if (!this.sitePolygon) return null;

        const coordinates = this.sitePolygon.geometry.coordinates[0];
        return {
            area: this.calculatePolygonArea(coordinates),
            perimeter: this.calculatePolygonPerimeter(coordinates),
            pointCount: coordinates.length - 1
        };
    }

    hasSiteBoundary() {
        return !!this.sitePolygon;
    }

    getBuildableAreaData() {
        return this.buildableAreaData;
    }

    getSiteData() {
        const siteData = {};

        if (this.hasSiteBoundary()) {
            const coordinates = this.sitePolygon.geometry.coordinates[0];
            const area = this.calculatePolygonArea(coordinates);
            const centerLng = coordinates.reduce((sum, coord) => sum + coord[0], 0) / coordinates.length;
            const centerLat = coordinates.reduce((sum, coord) => sum + coord[1], 0) / coordinates.length;

            siteData.coordinates = coordinates;
            siteData.area = area;
            siteData.area_m2 = area;
            siteData.center = { lng: centerLng, lat: centerLat };
            siteData.center_lng = centerLng;
            siteData.center_lat = centerLat;
            siteData.type = 'residential';
            siteData.perimeter = this.calculatePolygonPerimeter(coordinates);
            siteData.point_count = coordinates.length - 1;

            if (!siteData.terrainBounds) {
                siteData.terrainBounds = this.calculateTerrainBounds(coordinates);
            }
        }

        if (this.buildableAreaData) {
            siteData.buildable_area = this.buildableAreaData;
        }

        return siteData;
    }
}

// Make globally available
window.SiteBoundaryCore = SiteBoundaryCore;