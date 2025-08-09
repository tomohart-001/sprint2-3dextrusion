
/**
 * Draw Structure Manager - Handles interactive structure drawing with live preview
 * Modularized from FloorplanManager for better code organization
 */

// Ensure BaseManager is available or provide fallback
if (typeof BaseManager === 'undefined') {
    console.warn('[DrawStructureManager] BaseManager not available, using fallback');
    window.BaseManager = class {
        constructor(name) {
            this.name = name;
        }
        info(...args) { console.log(`[${this.name}] INFO:`, ...args); }
        warn(...args) { console.warn(`[${this.name}] WARN:`, ...args); }
        error(...args) { console.error(`[${this.name}] ERROR:`, ...args); }
    };
}

// Only declare DrawStructureManager if it doesn't already exist
if (typeof DrawStructureManager === 'undefined') {
    window.DrawStructureManager = class DrawStructureManager extends BaseManager {
        constructor(map, floorplanManager) {
            super('DrawStructureManager');

            this.map = map;
            this.floorplanManager = floorplanManager;
            this.draw = null;
            this.isDrawing = false;

            // Drawing state
            this.state = {
                isDrawing: false,
                drawingPoints: [],
                currentDrawMode: null
            };

            // Event handlers
            this.handleDrawingClick = null;
            this.handleDrawingMouseMove = null;
            this.handleDrawingUpdate = null;
        }

        async initialize() {
            this.info('Initializing Draw Structure Manager...');

            try {
                if (!this.map) {
                    throw new Error('Map instance required for DrawStructureManager');
                }

                if (!this.floorplanManager) {
                    throw new Error('FloorplanManager instance required for DrawStructureManager');
                }

                // Wait for draw control to be available
                this.setupDrawEventHandlers();

                this.info('✅ Draw Structure Manager initialized successfully');
            } catch (error) {
                this.error('Failed to initialize DrawStructureManager:', error);
                throw error;
            }
        }

        setupDrawEventHandlers() {
            // Check if draw control is available, if not, wait for it
            const checkDraw = () => {
                const core = window.siteInspectorCore;
                if (core && core.draw) {
                    this.draw = core.draw;
                    this.info('Draw control found for structure drawing');
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

        startDrawing() {
            if (!this.validateDrawingReadiness()) {
                return;
            }

            try {
                this.info('Starting structure drawing mode...');

                // Emit tool activation event
                if (window.eventBus) {
                    window.eventBus.emit('tool-activated', 'floorplan');
                }

                // Clear any existing structure visualizations
                this.floorplanManager.removeStructureVisualization();

                // Initialize drawing state
                this.isDrawing = true;
                this.state.isDrawing = true;
                this.state.drawingPoints = [];

                // Set up drawing preview sources and layers
                this.setupDrawingPreviewLayers();

                // Set up drawing event listeners for live preview
                this.setupDrawingPreview();

                // Start polygon drawing mode
                this.draw.changeMode('draw_polygon');

                // Show user feedback
                this.floorplanManager.showStatus('Click on the map to start drawing your structure footprint', 'info');

                this.info('✅ Structure drawing mode started successfully');

            } catch (error) {
                this.error('Failed to start structure drawing mode:', error);
                this.resetDrawingState();
                this.floorplanManager.showStatus('Failed to start drawing mode: ' + (error.message || 'Unknown error'), 'error');
            }
        }

        stopDrawing() {
            if (!this.draw) return;

            try {
                this.isDrawing = false;
                this.state.isDrawing = false;
                this.state.drawingPoints = [];
                this.removeDrawingPreview();
                this.clearDrawingVisualization();
                
                // Safely change draw mode back to simple_select
                if (this.draw && typeof this.draw.changeMode === 'function') {
                    const currentMode = this.draw.getMode();
                    if (currentMode !== 'simple_select') {
                        this.draw.changeMode('simple_select');
                    }
                }
                
                this.info('Structure drawing mode stopped - site boundary preserved');
            } catch (error) {
                this.error('Failed to stop structure drawing mode:', error);
                // Still try to reset state even if there's an error
                this.resetDrawingState();
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
                if (existingSource) {
                    let currentData;
                    try {
                        currentData = existingSource._data || { type: 'FeatureCollection', features: [] };
                    } catch (e) {
                        currentData = { type: 'FeatureCollection', features: [] };
                    }
                    
                    if (!currentData.features) {
                        currentData.features = [];
                    }
                    
                    currentData.features.push(pointFeature);
                    existingSource.setData(currentData);
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

        validateDrawingReadiness() {
            // Check if map is available
            if (!this.map) {
                this.error('Map instance not available');
                this.floorplanManager.showStatus('Map not ready for drawing', 'error');
                return false;
            }

            // Check if draw control is available
            if (!this.draw) {
                // Try to get it from siteInspectorCore
                const core = window.siteInspectorCore;
                if (core && core.draw) {
                    this.draw = core.draw;
                    this.info('Draw control obtained from siteInspectorCore');
                } else {
                    this.error('Draw control not available');
                    this.floorplanManager.showStatus('Drawing tools not ready. Please refresh the page.', 'error');
                    return false;
                }
            }

            // Verify draw control has required methods
            if (typeof this.draw.changeMode !== 'function') {
                this.error('Draw control not properly initialized');
                this.floorplanManager.showStatus('Drawing tools are not ready. Please refresh the page.', 'error');
                return false;
            }

            return true;
        }

        resetDrawingState() {
            this.isDrawing = false;
            this.state.drawingPoints = [];
            this.state.currentDrawMode = null;
            this.clearDrawingVisualization();
        }

        // Public getters
        isDrawingActive() {
            return this.isDrawing;
        }

        getDrawingPoints() {
            return this.state.drawingPoints;
        }

        // Cleanup method
        cleanup() {
            this.removeDrawingPreview();
            this.clearDrawingVisualization();
            this.resetDrawingState();
            this.info('Draw Structure Manager cleaned up');
        }
    };

    // Make available globally
    window.DrawStructureManager = DrawStructureManager;
}
