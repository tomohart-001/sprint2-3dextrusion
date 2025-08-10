/**
 * Site Boundary Core - Refined Implementation
 * Handles site boundary drawing, validation, and buildable area calculations.
 * Notes:
 *  - Adds initialize() so SiteInspectorCore.initializeManagers() works.
 *  - Unifies createEdgeClassifications() signature and fixes preview/final mismatch.
 *  - Avoids messing with shared "buildable-area" layers; only updates/creates the source.
 *  - Removes use of private Mapbox GL internals (_data) for point source.
 *  - Tracks and cleans up all listeners via this.cleanup.
 */

class SiteBoundaryCore extends MapManagerBase {
    constructor(map, draw) {
        super('SiteBoundaryCore', map);
        this.draw = draw;

        // State
        this.sitePolygon = null;
        this.polygonEdges = [];
        this.legalPropertyBoundary = null; // Store legal property boundary separately
        this.legalPropertyEdges = [];     // Store edges for legal property boundary
        this.legalBoundaryApplied = false; // Flag to indicate if legal boundary is active
        this.isLocked = false;
        this.isDrawing = false;
        this.drawingPoints = [];
        this.buildableAreaData = null;

        // Local FC cache for points (avoid using private mapbox source internals)
        this._pointFC = { type: 'FeatureCollection', features: [] };

        // Controls / cleanup
        this.previewAbortController = null;
        this.cleanup = this.cleanup || [];

        // Configuration
        this.config = {
            minPolygonPoints: 3,
            coordinateTolerance: 0.000001,
            maxCoordinateRetries: 3,
            defaultBufferMeters: 50
        };

        // Source / layer ids owned by this module
        this.sourceIds = {
            preview: 'boundary-drawing-preview',
            points: 'boundary-drawing-points',
            dimensions: 'boundary-dimensions',
            final: 'site-boundary-final',
            // NOTE: we will only update this source; layers are owned by SiteInspectorCore
            buildableArea: 'buildable-area'
        };

        this.layerIds = {
            previewLine: 'boundary-preview-line',
            previewFill: 'boundary-preview-fill',
            points: 'boundary-drawing-points',
            dimensions: 'boundary-dimension-labels',
            finalFill: 'site-boundary-fill',
            finalStroke: 'site-boundary-stroke'
            // Do NOT place buildable-area layers here; Core owns them.
        };
    }

    // Added so SiteInspectorCore can await this
    async initialize() {
        await this.validateDependencies();
        await this.setup();
        await this.postInitialize();
    }

    async validateDependencies() {
        await super.validateDependencies();
        if (!this.draw) {
            this.warn('MapboxDraw not available - drawing features limited');
            // still allow initialization so legal boundary load can work
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
        const empty = { type: 'FeatureCollection', features: [] };

        // Only add sources we exclusively own
        Object.entries(this.sourceIds).forEach(([key, id]) => {
            // Skip creating the shared buildable-area source here; we’ll create it lazily when needed
            if (key === 'buildableArea') return;
            try {
                if (!this.map.getSource(id)) {
                    this.addSource(id, { type: 'geojson', data: empty });
                }
            } catch (error) {
                this.error(`Failed to add source ${id}:`, error);
            }
        });
    }

    setupDrawingLayers() {
        const config = window.SiteInspectorConfig;
        if (!config) {
            this.error('SiteInspectorConfig not available');
            return;
        }

        // Clear only layers this module owns
        this.clearExistingLayers();

        const layerConfigs = [
            {
                id: this.layerIds.previewFill,
                type: 'fill',
                source: this.sourceIds.preview,
                paint: {
                    'fill-color': ['case', ['==', ['get', 'type'], 'preview-polygon-live'], '#ff6b35', '#547bf7'],
                    'fill-opacity': ['case', ['==', ['get', 'type'], 'preview-polygon-live'], 0.2, 0.3]
                },
                filter: ['in', ['get', 'type'], ['literal', ['preview-polygon', 'preview-polygon-live']]]
            },
            {
                id: this.layerIds.previewLine,
                type: 'line',
                source: this.sourceIds.preview,
                paint: {
                    'line-color': ['case', ['==', ['get', 'type'], 'preview-line-live'], '#ff6b35', '#547bf7'],
                    'line-width': ['case', ['==', ['get', 'type'], 'preview-line-live'], 2, 3],
                    'line-dasharray': ['case', ['==', ['get', 'type'], 'preview-line-live'], ['literal', [2, 2]], ['literal', []]],
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
                    'text-color': config.get ? config.get('colors.primary') : '#547bf7',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                }
            }
        ];

        layerConfigs.forEach(layerConfig => {
            try {
                if (!this.map.getLayer(layerConfig.id)) {
                    this.addLayer(layerConfig);
                }
            } catch (error) {
                this.error(`Failed to add layer ${layerConfig.id}:`, error);
            }
        });
    }

    setupEventHandlers() {
        this.setupUIEventHandlers();

        if (this.map && this.draw) {
            this.setupDrawingEventHandlers();
        } else {
            this.warn('Map or draw not available for draw event handlers');
        }
    }

    setupUIEventHandlers() {
        const handlers = [
            { id: 'drawPolygonButton', fn: () => this.safeToggleDrawingMode() },
            { id: 'stopDrawingButton', fn: () => this.safeStopDrawingMode() },
            { id: 'clearBoundaryButton', fn: () => this.safeClearBoundary() },
            { id: 'clearBoundaryButton2', fn: () => this.safeClearBoundary() },
            { id: 'confirmBoundaryButton', fn: () => this.safeConfirmBoundary() },
            { id: 'useLegalBoundaryButton', fn: () => this.safeUseLegalBoundary() }
        ];

        handlers.forEach(({ id, fn }) => {
            const el = this.getElementById(id, false);
            if (!el) return;
            el.addEventListener('click', fn);
            this.cleanup.push(() => {
                try { el.removeEventListener('click', fn); } catch (_) {}
            });
        });

        // Event bus listeners (track for cleanup if off() exists)
        const clearDependent = () => { this.info('Clearing boundary via event'); this.clearBoundary(); };
        if (window.eventBus?.on) {
            window.eventBus.on('clear-all-dependent-features', clearDependent);
            window.eventBus.on('clear-all-site-data', clearDependent);

            // keep references to remove later (if off exists)
            this._busHandlers = [
                ['clear-all-dependent-features', clearDependent],
                ['clear-all-site-data', clearDependent]
            ];
            if (window.eventBus.off) {
                this.cleanup.push(() => {
                    this._busHandlers.forEach(([evt, h]) => {
                        try { window.eventBus.off(evt, h); } catch (_) {}
                    });
                });
            }
        }

        this.setupLegalBoundaryButtonState();
    }

    setupDrawingEventHandlers() {
        const onCreate = (e) => this.safeHandlePolygonCreated(e);
        const onUpdate = (e) => this.safeHandlePolygonUpdated(e);
        const onDelete = (e) => this.safeHandlePolygonDeleted(e);
        const onMode   = (e) => this.safeHandleModeChange(e);

        this.map.on('draw.create', onCreate);
        this.map.on('draw.update', onUpdate);
        this.map.on('draw.delete', onDelete);
        this.map.on('draw.modechange', onMode);

        this.cleanup.push(() => { try { this.map.off('draw.create', onCreate); } catch (_) {} });
        this.cleanup.push(() => { try { this.map.off('draw.update', onUpdate); } catch (_) {} });
        this.cleanup.push(() => { try { this.map.off('draw.delete', onDelete); } catch (_) {} });
        this.cleanup.push(() => { try { this.map.off('draw.modechange', onMode); } catch (_) {} });

        this.info('Drawing event handlers setup completed');
    }

    // ---------- Safe wrappers ----------
    safeToggleDrawingMode() {
        try {
            this.toggleDrawingMode();
        } catch (e) {
            this.error('toggleDrawingMode error', e);
            this.showUserError('Failed to toggle drawing mode. Please refresh.');
        }
    }

    safeStopDrawingMode() {
        try {
            this.stopDrawingMode();
        } catch (e) {
            this.error('stopDrawingMode error', e);
        }
    }

    safeClearBoundary() {
        try {
            this.clearBoundary();
        } catch (e) {
            this.error('clearBoundary error', e);
        }
    }

    safeConfirmBoundary() {
        try {
            this.confirmBoundary();
        } catch (e) {
            this.error('confirmBoundary error', e);
        }
    }

    safeUseLegalBoundary() {
        try {
            this.useLegalPropertyBoundary();
        } catch (e) {
            this.error('useLegalPropertyBoundary error', e);
            this.showUserError('Failed to use legal property boundary: ' + e.message);
        }
    }

    // ---------- Readiness / buttons ----------
    enableDrawingTools() {
        const enable = () => {
            const drawBtn = this.getElementById('drawPolygonButton', false);
            if (drawBtn) {
                const ready = !!(this.map && this.draw && typeof this.draw.changeMode === 'function');
                drawBtn.disabled = !ready;
                drawBtn.style.opacity = ready ? '1' : '0.5';
                drawBtn.textContent = 'Draw Site Boundary';
                drawBtn.classList.remove('active');
            }
            this.info('Drawing tools enabled and ready check completed');
        };

        if (this.map && !this.map.isStyleLoaded()) {
            this.map.once('styledata', enable);
            this.cleanup.push(() => { try { this.map.off('styledata', enable); } catch (_) {} });
        } else {
            enable();
        }
    }

    setupLegalBoundaryButtonState() {
        try {
            const btn = this.getElementById('useLegalBoundaryButton', false);
            if (!btn) return;

            const siteData = window.siteData || {};
            const projectData = window.projectData || {};
            let center = siteData.center;
            if (!center && projectData.lat && projectData.lng) {
                center = { lat: projectData.lat, lng: projectData.lng };
            }
            if (!center || !center.lat || !center.lng) {
                // Default to Wellington so UI is deterministic
                center = { lat: -41.2865, lng: 174.7762 };
            }

            const isInNZ = this.isLocationInNewZealand(center.lat, center.lng);
            if (isInNZ) {
                btn.disabled = false; btn.style.opacity = '1'; btn.title = 'Use official property boundary from LINZ';
            } else {
                btn.disabled = true; btn.style.opacity = '0.5'; btn.style.background = '#e9ecef';
                btn.style.color = '#6c757d'; btn.title = 'Legal property boundaries are only available within New Zealand';
            }
        } catch (error) {
            this.error('Error setting legal boundary button state:', error);
        }
    }

    validateDrawingReadiness() {
        if (!this.map) {
            this.error('Map is not available');
            this.showUserError('Map is not available. Please refresh the page.');
            return false;
        }

        if (!this.map.isStyleLoaded()) {
            this.warn('Map style is still loading');
            this.showUserError('Map is still loading. Please wait a moment and try again.');
            return false;
        }

        if (!this.draw) {
            this.error('Draw instance is not available');
            this.showUserError('Drawing tools are not initialized. Please refresh the page.');
            return false;
        }

        if (typeof this.draw.changeMode !== 'function') {
            this.error('Draw.changeMode is not a function');
            this.showUserError('Drawing tools are not properly configured. Please refresh the page.');
            return false;
        }

        // Check if the draw control is actually added to the map
        try {
            const currentMode = this.draw.getMode();
            this.debug('Current draw mode:', currentMode);
            if (!currentMode) {
                this.warn('Draw control has no mode - attempting to initialize');
                // Try to set a default mode to initialize
                try {
                    this.draw.changeMode('simple_select');
                    const newMode = this.draw.getMode();
                    if (!newMode) {
                        this.error('Draw control failed to initialize after mode reset');
                        this.showUserError('Drawing control is not properly initialized. Please refresh the page.');
                        return false;
                    }
                    this.info('Draw control initialized with mode:', newMode);
                } catch (initError) {
                    this.error('Failed to initialize draw control:', initError);
                    this.showUserError('Drawing control initialization failed. Please refresh the page.');
                    return false;
                }
            }
        } catch (error) {
            this.error('Error checking draw mode:', error);
            this.showUserError('Drawing control is not properly connected to the map. Please refresh the page.');
            return false;
        }

        return true;
    }

    toggleDrawingMode() {
        if (!this.validateDrawingReadiness()) return;
        if (this.isDrawing) this.stopDrawingMode();
        else this.startDrawingMode();
    }

    startDrawingMode() {
        if (!this.validateDrawingReadiness()) return;
        try {
            this.info('Starting drawing mode...');

            // More robust validation
            if (!this.draw) {
                throw new Error('MapboxDraw instance not available');
            }

            if (typeof this.draw.changeMode !== 'function') {
                throw new Error('MapboxDraw not properly initialized - changeMode method missing');
            }

            // Clear any existing drawing state first
            this.clearDrawingVisualization();
            this.drawingPoints = [];
            this.safeDeleteAllFeatures();

            // Clean up any existing draw sources that might conflict
            this.cleanupConflictingSources();

            // Wait a bit for cleanup to complete
            setTimeout(() => {
                try {
                    this.isDrawing = true;
                    this.updateButtonState('drawPolygonButton', 'active', 'Stop Drawing');

                    this.setupDrawingPreview();

                    // Verify map is ready before changing mode
                    if (!this.map.isStyleLoaded()) {
                        throw new Error('Map style not loaded - please wait and try again');
                    }

                    // Try to change mode with better error handling
                    try {
                        this.draw.changeMode('simple_select');
                        // Small delay before switching to draw mode
                        setTimeout(() => {
                            try {
                                this.draw.changeMode('draw_polygon');
                                this.info('Draw mode changed to draw_polygon');

                                // Verify mode change after a delay
                                setTimeout(() => {
                                    try {
                                        const currentMode = this.draw.getMode?.();
                                        if (currentMode !== 'draw_polygon') {
                                            this.warn('Draw mode verification failed. Expected: draw_polygon, Got:', currentMode);
                                            // Final attempt
                                            this.draw.changeMode('draw_polygon');
                                        } else {
                                            this.info('Draw mode verified successfully:', currentMode);
                                        }
                                    } catch (verifyError) {
                                        this.warn('Could not verify draw mode:', verifyError);
                                    }
                                }, 150);
                            } catch (drawError) {
                                this.error('Failed to set draw_polygon mode:', drawError);
                                throw new Error('Failed to activate drawing mode: ' + drawError.message);
                            }
                        }, 100);
                    } catch (modeError) {
                        throw new Error('Failed to initialize drawing mode: ' + modeError.message);
                    }

                    this.info('Drawing mode started successfully');
                } catch (delayedError) {
                    this.error('Failed to start drawing mode (delayed):', delayedError);
                    this.resetDrawingState();
                    this.showUserError('Failed to start drawing mode: ' + delayedError.message);
                }
            }, 200);

        } catch (error) {
            this.error('Failed to start drawing mode:', error);
            this.resetDrawingState();
            const errorMessage = error.message || 'Drawing tools not properly initialized. Please refresh the page.';
            this.showUserError('Failed to start drawing mode: ' + errorMessage);
        }
    }

    cleanupConflictingSources() {
        try {
            // Clean up any mapbox-gl-draw sources that might be conflicting
            const conflictingSources = [
                'mapbox-gl-draw-cold',
                'mapbox-gl-draw-hot',
                'mapbox-gl-draw-polygons-cold',
                'mapbox-gl-draw-polygons-hot',
                'mapbox-gl-draw-vertices-cold',
                'mapbox-gl-draw-vertices-hot'
            ];

            // Also clean up any lingering draw layers
            const conflictingLayers = [
                'gl-draw-polygon-fill-inactive',
                'gl-draw-polygon-stroke-inactive',
                'gl-draw-polygon-fill-active',
                'gl-draw-polygon-stroke-active',
                'gl-draw-line-active',
                'gl-draw-point-active',
                'gl-draw-point-inactive'
            ];

            conflictingLayers.forEach(layerId => {
                if (this.map.getLayer && this.map.getLayer(layerId)) {
                    try {
                        this.map.removeLayer(layerId);
                        this.info('Removed conflicting layer:', layerId);
                    } catch (removeError) {
                        this.warn('Could not remove conflicting layer:', layerId, removeError);
                    }
                }
            });

            conflictingSources.forEach(sourceId => {
                if (this.map.getSource && this.map.getSource(sourceId)) {
                    try {
                        this.map.removeSource(sourceId);
                        this.info('Removed conflicting source:', sourceId);
                    } catch (removeError) {
                        this.warn('Could not remove conflicting source:', sourceId, removeError);
                    }
                }
            });
        } catch (error) {
            this.warn('Error during source cleanup:', error);
        }
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

    safeDeleteAllFeatures() {
        try { this.draw?.deleteAll?.(); } catch (e) { this.warn('Could not clear existing features:', e); }
    }

    verifyModeChange() {
        setTimeout(() => {
            try {
                const currentMode = this.draw?.getMode?.();
                if (currentMode !== 'draw_polygon') this.warn('Drawing mode may not have activated. Current:', currentMode);
            } catch (error) { this.warn('Could not verify drawing mode:', error); }
        }, 100);
    }

    // ---------- Preview listeners ----------
    setupDrawingPreview() {
        const onClick = (e) => this.handleDrawingClick(e);
        const onMove  = (e) => this.handleDrawingMouseMove(e);
        const onUpd   = (e) => this.handleDrawingUpdate(e);
        const onSel   = (e) => this.handleDrawingSelectionChange(e);

        this.map.on('click', onClick);
        this.map.on('mousemove', onMove);
        this.map.on('draw.update', onUpd);
        this.map.on('draw.selectionchange', onSel);

        this.cleanup.push(() => { try { this.map.off('click', onClick); } catch (_) {} });
        this.cleanup.push(() => { try { this.map.off('mousemove', onMove); } catch (_) {} });
        this.cleanup.push(() => { try { this.map.off('draw.update', onUpd); } catch (_) {} });
        this.cleanup.push(() => { try { this.map.off('draw.selectionchange', onSel); } catch (_) {} });

        this.info('Drawing preview listeners set up');
    }

    removeDrawingPreview() {
        // No-op: removal is handled by cleanup entries
        this.info('Drawing preview listeners removal deferred to cleanup');
    }

    handleDrawingClick(e) {
        if (!this.isDrawing) return;
        try {
            const point = [e.lngLat.lng, e.lngLat.lat];
            this.drawingPoints.push(point);
            this.updateDrawingPreview();
            this.addDrawingPointMarker(point, this.drawingPoints.length - 1);
        } catch (error) {
            this.error('Error handling drawing click:', error);
        }
    }

    handleDrawingMouseMove(e) {
        if (!this.isDrawing || this.drawingPoints.length === 0) return;
        try {
            this.updateLiveDrawingPreview([e.lngLat.lng, e.lngLat.lat]);
        } catch (error) {
            /* suppress */
        }
    }

    handleDrawingUpdate(e) {
        if (!this.isDrawing) return;
        try {
            const coords = e?.features?.[0]?.geometry?.coordinates?.[0];
            if (coords?.length) {
                this.drawingPoints = coords.slice(0, -1); // remove closing point
                this.updateDrawingPreview();
            }
        } catch (error) {
            this.warn('Error handling drawing update:', error);
        }
    }

    handleDrawingSelectionChange(e) {
        this.debug('Drawing selection change:', e);
    }

    // ---------- Preview drawing/update ----------
    updateDrawingPreview() {
        try {
            const features = [];

            if (this.drawingPoints.length >= 2) {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: this.drawingPoints },
                    properties: { type: 'preview-line' }
                });
            }

            if (this.drawingPoints.length >= 3) {
                const closedCoords = [...this.drawingPoints, this.drawingPoints[0]];
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [closedCoords] },
                    properties: { type: 'preview-polygon' }
                });
            }

            this.updateSource(this.sourceIds.preview, { type: 'FeatureCollection', features });

            this.updateDrawingDimensions();
            this.info(`Drawing preview updated (${features.length} features, ${this.drawingPoints.length} points)`);
        } catch (error) { this.error('Error updating drawing preview:', error); }
    }

    updateLiveDrawingPreview(mousePoint) {
        if (this.drawingPoints.length === 0) return;
        try {
            const staticFeatures = this.getStaticPreviewFeatures();
            const live = [];

            if (this.drawingPoints.length >= 1) {
                const last = this.drawingPoints[this.drawingPoints.length - 1];
                live.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [last, mousePoint] },
                    properties: { type: 'preview-line-live' }
                });
            }

            if (this.drawingPoints.length >= 2) {
                const previewCoords = [...this.drawingPoints, mousePoint, this.drawingPoints[0]];
                live.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [previewCoords] },
                    properties: { type: 'preview-polygon-live' }
                });
            }

            this.updateSource(this.sourceIds.preview, { type: 'FeatureCollection', features: [...staticFeatures, ...live] });
        } catch (error) { /* suppress */ }
    }

    getStaticPreviewFeatures() {
        const features = [];
        if (this.drawingPoints.length >= 2) {
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: this.drawingPoints },
                properties: { type: 'preview-line' }
            });
        }
        if (this.drawingPoints.length >= 3) {
            const closedCoords = [...this.drawingPoints, this.drawingPoints[0]];
            features.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [closedCoords] },
                properties: { type: 'preview-polygon' }
            });
        }
        return features;
    }

    addDrawingPointMarker(point, index) {
        try {
            this._pointFC.features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: point },
                properties: { index, type: 'drawing-point' }
            });
            this.updateSource(this.sourceIds.points, this._pointFC);
        } catch (error) { this.error('Error adding drawing point marker:', error); }
    }

    updateDrawingDimensions() {
        if (this.drawingPoints.length < 2) return;
        try {
            const dimensionFeatures = [];
            for (let i = 0; i < this.drawingPoints.length - 1; i++) {
                const start = this.drawingPoints[i], end = this.drawingPoints[i + 1];
                const distance = this.calculateDistance(start[0], start[1], end[0], end[1]);
                const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
                dimensionFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: midpoint },
                    properties: { distance: `${distance.toFixed(1)}m`, type: 'drawing-dimension' }
                });
            }
            this.updateSource(this.sourceIds.dimensions, { type: 'FeatureCollection', features: dimensionFeatures });
        } catch (error) { this.error('Error updating drawing dimensions:', error); }
    }

    clearDrawingVisualization() {
        const empty = { type: 'FeatureCollection', features: [] };
        this._pointFC = { type: 'FeatureCollection', features: [] };
        this.updateSource(this.sourceIds.preview, empty);
        this.updateSource(this.sourceIds.points, this._pointFC);
        this.updateSource(this.sourceIds.dimensions, empty);
        this.drawingPoints = [];
    }

    resetDrawingState() {
        this.isDrawing = false;
        this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');
        this.clearDrawingVisualization();
    }

    // ---------- Draw events ----------
    safeHandlePolygonCreated(e) {
        try {
            this.handlePolygonCreated(e);
        } catch (error) {
            this.error('polygon create error:', error);
            this.resetDrawingState();
        }
    }

    safeHandlePolygonUpdated(e) {
        try {
            this.handlePolygonUpdated(e);
        } catch (error) {
            this.error('polygon update error:', error);
        }
    }

    safeHandlePolygonDeleted(e) {
        try {
            this.handlePolygonDeleted(e);
        } catch (error) {
            this.error('polygon delete error:', error);
        }
    }

    safeHandleModeChange(e) {
        try {
            this.handleModeChange(e);
        } catch (error) {
            this.error('mode change error:', error);
        }
    }

    handleModeChange(e) {
        if (!e || typeof e.mode !== 'string') return;
        const wasDrawing = this.isDrawing;
        this.isDrawing = e.mode === 'draw_polygon' || e.mode === 'DRAW_POLYGON';
        if (this.isDrawing && !wasDrawing) this.updateButtonState('drawPolygonButton', 'active', 'Stop Drawing');
        else if (!this.isDrawing && wasDrawing) this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');
    }

    // ---------- Create / update / delete polygon ----------
    handlePolygonCreated(e) {
        this.info('Polygon creation event received');
        this.validatePolygonEvent(e);

        const coordinates = this.processPolygonCoordinates(e.features[0]);
        const feature = this.createPolygonFeature(coordinates);
        this.sitePolygon = feature;

        const metrics = this.calculatePolygonMetrics(coordinates);
        this.polygonEdges = metrics.edges;

        this.clearDrawingVisualization();
        this.updateBoundaryDisplay(metrics.area, metrics.perimeter, coordinates.length - 1);
        this.updateButtonStates(true);
        this.showFinalDimensions(coordinates);
        this.showFinalBoundary(coordinates);
        this.resetDrawingState();

        setTimeout(() => { try { this.draw?.changeMode?.('simple_select'); } catch (_) {} }, 100);

        this.emitBoundaryCreatedEvent(coordinates, metrics);
        this.info(`Site boundary created: area=${metrics.area.toFixed(2)} m², vertices=${coordinates.length - 1}`);
    }

    handlePolygonUpdated(e) { this.handlePolygonCreated(e); }

    handlePolygonDeleted(e) { this.clearBoundary(); }

    validatePolygonEvent(e) {
        if (!e?.features?.[0]?.geometry?.coordinates?.[0]) {
            throw new Error('Invalid polygon event/geometry');
        }
        const coordinates = e.features[0].geometry.coordinates[0];
        if (coordinates.length < this.config.minPolygonPoints + 1) {
            throw new Error(`Polygon must have at least ${this.config.minPolygonPoints} points`);
        }
    }

    processPolygonCoordinates(feature) {
        const coordinates = feature.geometry.coordinates[0];
        this.info(`Processing ${coordinates.length} coords`);
        const cleaned = this.cleanCoordinates(coordinates);
        if (cleaned.length < this.config.minPolygonPoints) throw new Error('Not enough valid coordinates');
        return this.ensureClosedPolygon(cleaned);
    }

    cleanCoordinates(coordinates) {
        const clean = [];
        for (let i = 0; i < coordinates.length; i++) {
            const coord = coordinates[i];
            if (!Array.isArray(coord) || coord.length !== 2) continue;
            const [lng, lat] = [parseFloat(coord[0]), parseFloat(coord[1])];
            if (isNaN(lng) || isNaN(lat)) continue;
            if (!this.isValidCoordinateRange(lng, lat)) continue;
            clean.push([lng, lat]);
        }
        return clean;
    }

    ensureClosedPolygon(coordinates) {
        const first = coordinates[0], last = coordinates[coordinates.length - 1];
        if (!this.pointsAreEqual(first, last)) coordinates.push([...first]);
        return coordinates;
    }

    pointsAreEqual(p1, p2, tol = this.config.coordinateTolerance) {
        return Math.abs(p1[0] - p2[0]) < tol && Math.abs(p1[1] - p2[1]) < tol;
    }

    isValidCoordinateRange(lng, lat) { return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90; }

    createPolygonFeature(coordinates) {
        return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coordinates] } };
    }

    calculatePolygonMetrics(coordinates) {
        const area = this.calculatePolygonArea(coordinates);
        const perimeter = this.calculatePolygonPerimeter(coordinates);
        const edges = this.calculatePolygonEdges(coordinates);
        if (!area || isNaN(area) || area <= 0) throw new Error('Invalid polygon area');
        return { area, perimeter, edges };
    }

    updateBoundaryDisplay(area, perimeter, pointCount) {
        this.setElementDisplay('boundaryInfoDisplay', 'block');
        this.setElementText('boundaryAreaDisplay', `${area.toFixed(2)} m²`);
        this.setElementText('boundaryPerimeterDisplay', `${perimeter.toFixed(2)} m`);
        this.setElementText('boundaryPointsDisplay', `${pointCount}`);
    }

    updateButtonStates(polygonCreated = false, boundaryExists = false) {
        const draw = this.getElementById('drawPolygonButton', false);
        const confirm = this.getElementById('confirmBoundaryButton', false);
        const clear = this.getElementById('clearBoundaryButton', false);
        const clear2 = this.getElementById('clearBoundaryButton2', false);

        if (polygonCreated || boundaryExists) {
            if (confirm) confirm.style.display = boundaryExists ? 'none' : 'inline-block';
            if (clear) clear.style.display = 'inline-block';
            if (clear2) clear2.style.display = boundaryExists ? 'inline-block' : 'none';
            if (draw && boundaryExists) draw.style.display = 'none';
        } else {
            if (confirm) confirm.style.display = 'none';
            if (clear) clear.style.display = 'none';
            if (clear2) clear2.style.display = 'none';
            if (draw) draw.style.display = 'inline-block';
        }
    }

    showFinalDimensions(coordinates) {
        const features = [];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const start = coordinates[i], end = coordinates[i + 1];
            const distance = this.calculateDistance(start[0], start[1], end[0], end[1]);
            const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: midpoint },
                properties: { distance: `${distance.toFixed(1)}m`, type: 'final-dimension' }
            });
        }
        this.updateSource(this.sourceIds.dimensions, { type: 'FeatureCollection', features });
    }

    showFinalBoundary(coordinates) {
        try {
            const boundaryFeature = {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [coordinates] },
                properties: { type: 'site-boundary' }
            };
            this.updateSource(this.sourceIds.final, { type: 'FeatureCollection', features: [boundaryFeature] });
            this.ensureFinalBoundaryLayers();
        } catch (error) { this.error('Error showing final boundary:', error); }
    }

    ensureFinalBoundaryLayers() {
        // Add or ensure visibility of final boundary layers (owned here)
        if (!this.map.getLayer(this.layerIds.finalFill)) {
            try {
                this.map.addLayer({
                    id: this.layerIds.finalFill,
                    type: 'fill',
                    source: this.sourceIds.final,
                    paint: { 'fill-color': '#547bf7', 'fill-opacity': 0.3 }
                });
            } catch (e) { this.warn('Could not add final fill layer:', e); }
        }
        if (!this.map.getLayer(this.layerIds.finalStroke)) {
            try {
                this.map.addLayer({
                    id: this.layerIds.finalStroke,
                    type: 'line',
                    source: this.sourceIds.final,
                    paint: { 'line-color': '#547bf7', 'line-width': 3, 'line-opacity': 0.8 }
                });
            } catch (e) { this.warn('Could not add final stroke layer:', e); }
        }
        try {
            this.map.setLayoutProperty(this.layerIds.finalFill, 'visibility', 'visible');
            this.map.setLayoutProperty(this.layerIds.finalStroke, 'visibility', 'visible');
        } catch (_) {}
    }

    confirmBoundary() {
        if (!this.sitePolygon) { this.warn('No boundary to confirm'); return; }
        this.isLocked = true;

        // Primary signal to the app
        window.eventBus?.emit?.('boundary-applied');
        this.info('Boundary confirmed and locked');

        this.updateButtonStates(false, true);

        // Fallback UI update
        setTimeout(() => {
            const ui = window.siteInspectorCore?.uiPanelManager;
            ui?.updateBoundaryAppliedState?.();
        }, 100);
    }

    clearBoundary() {
        this.info('Clearing site boundary...');
        try {
            this.resetDrawingState();

            // Clear polygon data
            this.sitePolygon = null;
            this.polygonEdges = [];
            this.legalPropertyBoundary = null; // Clear legal boundary data
            this.legalPropertyEdges = [];     // Clear legal property edges
            this.legalBoundaryApplied = false; // Reset flag
            this.buildableAreaData = null;
            this.isLocked = false;

            // Clear ALL session storage for site inspector
            try {
                const sessionKeysToRemove = [
                    'legal_boundary_applied',
                    'legal_boundary_coordinates',
                    'site_boundary_data',
                    'buildable_area_data',
                    'setback_data',
                    'structure_data',
                    'edge_classifications',
                    'edge_selections',
                    'site_inspector_state',
                    'boundary_confirmed',
                    'setbacks_applied',
                    'structure_created',
                    'extrusion_applied'
                ];

                sessionKeysToRemove.forEach(key => {
                    sessionStorage.removeItem(key);
                });
                this.info('All site inspector session data cleared');
            } catch (e) {
                this.warn('Could not clear session storage:', e);
            }

            // Clear MapboxDraw features first
            try {
                if (this.draw && this.draw.deleteAll) {
                    this.draw.deleteAll();
                }
            } catch (e) {
                this.warn('Could not clear draw features:', e);
            }

            // Clear visuals
            this.clearAllVisualizationLayers();

            // Force remove ALL boundary-related layers and sources
            try {
                const layersToRemove = [
                    // Site boundary layers (owned by this class)
                    this.layerIds.finalFill,
                    this.layerIds.finalStroke,
                    // Alternative naming that might exist
                    'site-boundary-fill',
                    'site-boundary-stroke',
                    // Property boundary layers
                    'property-boundaries-fill',
                    'property-boundaries-stroke'
                    // Buildable area layers (if any)
                    // 'buildable-area-fill', // This is handled by SiteInspectorCore
                    // 'buildable-area-stroke' // This is handled by SiteInspectorCore
                ];

                const sourcesToRemove = [
                    // Site boundary sources
                    this.sourceIds.final,
                    'site-boundary',
                    // Property boundary sources
                    'property-boundaries',
                    // Buildable area source
                    // this.sourceIds.buildableArea, // This is handled by SiteInspectorCore
                    // 'buildable-area' // This is handled by SiteInspectorCore
                ];

                layersToRemove.forEach(layerId => {
                    if (layerId && this.map.getLayer && this.map.getLayer(layerId)) {
                        try {
                            this.map.removeLayer(layerId);
                            this.info(`Removed layer: ${layerId}`);
                        } catch (e) {
                            this.warn(`Could not remove layer ${layerId}:`, e);
                        }
                    }
                });

                sourcesToRemove.forEach(sourceId => {
                    if (sourceId && this.map.getSource && this.map.getSource(sourceId)) {
                        try {
                            this.map.removeSource(sourceId);
                            this.info(`Removed source: ${sourceId}`);
                        } catch (e) {
                            this.warn(`Could not remove source ${sourceId}:`, e);
                        }
                    }
                });
            } catch (error) {
                this.warn('Error removing boundary layers:', error);
            }

            // Reset legal boundary button state
            this.resetLegalBoundaryButton();

            // Reset UI and draw button
            this.updateButtonStates(false, false);
            this.setElementDisplay('boundaryInfoDisplay', 'none');

            const drawBtn = this.getElementById('drawPolygonButton', false);
            if (drawBtn && this.map) {
                drawBtn.disabled = false;
                drawBtn.style.opacity = '1';
                drawBtn.textContent = 'Draw Site Boundary';
                drawBtn.classList.remove('active');
                drawBtn.style.display = 'inline-block';
            }

            // Clear buildable area display completely
            this.clearBuildableAreaDisplay();

            // Emit clear events
            this.emit('site-boundary-deleted');
            this.emit('clear-all-dependent-features');

            this.info('Site boundary cleared completely');
        } catch (error) {
            this.error('Error clearing site boundary:', error);
        }
    }

    clearAllVisualizationLayers() {
        this.clearDrawingVisualization();
        // Do not remove buildable-area layers (Core owns). Just clear our sources:
        const empty = { type: 'FeatureCollection', features: [] };
        try { this.updateSource(this.sourceIds.final, empty); } catch (_) {}
        try { this.updateSource(this.sourceIds.dimensions, empty); } catch (_) {}
    }

    clearExistingLayers() {
        // Only remove layers exclusively owned by this class
        const owned = [this.layerIds.previewFill, this.layerIds.previewLine, this.layerIds.points, this.layerIds.dimensions, this.layerIds.finalFill, this.layerIds.finalStroke];
        owned.forEach(id => {
            if (id && this.map.getLayer?.(id)) {
                try { this.map.removeLayer(id); } catch (_) {}
            }
        });
    }

    // ---------- Buildable area ----------
    async calculateBuildableArea(setbackData) {
        this.info('Calculating buildable area...', setbackData);
        try {
            if (!this.hasSiteBoundary()) throw new Error('No site boundary available');

            const result = await this.performBuildableAreaCalculation(setbackData);
            if (result?.buildable_coords?.length > 0) {
                this.buildableAreaData = result;

                // Update shared source only; Core owns layers
                this.updateBuildableAreaDisplay(result, false);

                // Persist snapshot
                await this.saveBuildableAreaToProject(result, setbackData);

                // Notify others
                this.emit('buildable-area-calculated', result);
                return result;
            }
            throw new Error(result?.error || 'No buildable area calculated');
        } catch (error) {
            this.error('Buildable area calculation failed:', error);
            throw error;
        }
    }

    // Alias expected by SiteInspectorCore.handleBuildableAreaPreview()
    async previewBuildableArea(data) {
        return this.calculateBuildableAreaPreview(data);
    }

    async calculateBuildableAreaPreview(data) {
        try {
            if (!this.sitePolygon?.geometry?.coordinates) {
                this.warn('No site boundary available for buildable area preview');
                return;
            }

            const site_coords = this.sitePolygon.geometry.coordinates[0];
            const calculationData = {
                site_coords,
                requirements: {
                    front_setback: data.frontSetback ?? 4.5,
                    side_setback:  data.sideSetback  ?? 1.5,
                    rear_setback:  data.backSetback  ?? 3.5
                },
                frontage: data.frontage || 'north',
                edge_classifications: this.createEdgeClassifications({
                    selectedEdges: data.selectedEdges,
                    frontSetback: data.frontSetback,
                    sideSetback: data.sideSetback,
                    backSetback: data.backSetback
                })
            };

            const response = await fetch('/api/calculate-buildable-area', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(calculationData)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();

            // Update the shared source (no layers)
            if (result?.buildable_coords?.length) this.updateBuildableAreaDisplay(result, true);
            else this.clearBuildableAreaDisplay();

            return result;
        } catch (error) {
            this.error('Error calculating buildable area preview:', error);
        }
    }

    async performBuildableAreaCalculation(setbackData) {
        const siteCoords = this.sitePolygon.geometry.coordinates[0];
        const requirements = {
            front_setback: setbackData.frontSetback,
            side_setback: setbackData.sideSetback,
            rear_setback: setbackData.backSetback
        };
        const edgeClassifications = this.createEdgeClassifications({
            selectedEdges: setbackData.selectedEdges,
            frontSetback: setbackData.frontSetback,
            sideSetback: setbackData.sideSetback,
            backSetback: setbackData.backSetback
        });

        const response = await fetch('/api/calculate-buildable-area', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site_coords: siteCoords, frontage: 'north', requirements, edge_classifications: edgeClassifications })
        });

        if (!response.ok) throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        return await response.json();
    }

    // Unified signature
    createEdgeClassifications({ selectedEdges, frontSetback, sideSetback, backSetback }) {
        const out = [];
        const defaultSide = parseFloat(sideSetback) || 0;
        this.polygonEdges.forEach((edge, index) => {
            let type = 'side';
            let setback = defaultSide;
            if (selectedEdges?.front?.index === index) { type = 'front'; setback = parseFloat(frontSetback) || 0; }
            if (selectedEdges?.back?.index  === index) { type = 'back';  setback = parseFloat(backSetback)  || 0; }
            out.push({ index, type, setback });
        });
        return out;
    }

    updateBuildableAreaDisplay(result, isPreview = false) {
        this.info('Updating buildable area source (no layers)');

        if (!result?.buildable_coords?.length) { this.clearBuildableAreaDisplay(); return; }

        // Robust coordinate handling (backend might return [lat,lng])
        let coordinates = result.buildable_coords.slice();
        const looksLatLng = coordinates.length && Math.abs(coordinates[0][0]) <= 90 && Math.abs(coordinates[0][1]) > 90;
        if (looksLatLng) coordinates = coordinates.map(([lat, lng]) => [lng, lat]);

        // Ensure closed
        if (coordinates.length) {
            const [fx, fy] = coordinates[0];
            const [lx, ly] = coordinates[coordinates.length - 1];
            if (fx !== lx || fy !== ly) coordinates.push([fx, fy]);
        }

        // Upsert shared source; do not add/remove layers here
        const fc = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [coordinates] },
                properties: { type: 'buildable-area', is_preview: isPreview }
            }]
        };

        try {
            const src = this.map.getSource(this.sourceIds.buildableArea);
            if (src) src.setData(fc);
            else this.map.addSource(this.sourceIds.buildableArea, { type: 'geojson', data: fc });
        } catch (e) {
            this.error('Failed to update buildable-area source:', e);
        }

        // Let others (Core/UI) react if they want
        window.eventBus?.emit?.('buildable-area-updated', { isPreview, result });
    }

    clearBuildableAreaDisplay() {
        try {
            const src = this.map.getSource(this.sourceIds.buildableArea);
            if (src) src.setData({ type: 'FeatureCollection', features: [] });
        } catch (error) { this.error('Error clearing buildable area display:', error); }
    }

    async saveBuildableAreaToProject(result, setbackData) {
        try {
            const projectId = this.getProjectIdFromUrl();
            if (!projectId) { this.warn('No project ID found; skipping save'); return; }

            const snapshotData = this.createSnapshotData(result, setbackData);
            const response = await fetch(`/api/project/${projectId}/snapshot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshot_type: 'buildable_area', snapshot_data: JSON.stringify(snapshotData) })
            });
            const data = await response.json();
            if (!data.success) this.error('Failed to save buildable area', data.error);
            else this.info('Buildable area saved to project', projectId);
        } catch (error) { this.error('Error saving buildable area:', error); }
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

    captureTerrainBounds() {
        if (!this.map) return null;
        try {
            const b = this.map.getBounds(), c = this.map.getCenter(), z = this.map.getZoom();
            return {
                bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
                center: [c.lng, c.lat],
                zoom: z,
                width: b.getEast() - b.getWest(),
                height: b.getNorth() - b.getSouth(),
                timestamp: new Date().toISOString()
            };
        } catch (e) { this.error('Error capturing terrain bounds:', e); return null; }
    }

    // ---------- Geometry helpers ----------
    calculatePolygonArea(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;
        // Prefer Turf if available
        try {
            if (typeof turf !== 'undefined' && turf.area && turf.polygon) {
                return turf.area(turf.polygon([coordinates]));
            }
        } catch (error) { this.warn('Turf area error:', error); }

        // Fallback (approximate): shoelace on degrees -> m²
        try {
            const coords = this.normalizeCoordinates(coordinates);
            let area = 0;
            for (let i = 0; i < coords.length; i++) {
                const j = (i + 1) % coords.length;
                const [xi, yi] = coords[i], [xj, yj] = coords[j];
                area += xi * yj - xj * yi;
            }
            area = Math.abs(area) / 2;
            return area * 111320 * 111320; // crude meters² conversion
        } catch (e) { this.error('Fallback area calc error:', e); return 0; }
    }

    calculatePolygonPerimeter(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;
        let perimeter = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
            const a = coordinates[i], b = coordinates[i + 1];
            perimeter += this.calculateDistance(a[0], a[1], b[0], b[1]);
        }
        return perimeter;
    }

    calculateDistance(lng1, lat1, lng2, lat2) {
        const R = 6371000;
        const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
        const dφ = (lat2 - lat1) * Math.PI / 180, dλ = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }

    calculatePolygonEdges(coordinates) {
        const edges = [];
        if (!coordinates || coordinates.length < 3) return edges;
        const coords = this.normalizeCoordinates(coordinates);
        for (let i = 0; i < coords.length; i++) {
            const start = coords[i], end = coords[(i + 1) % coords.length];
            if (this.isValidCoordinate(start) && this.isValidCoordinate(end)) {
                edges.push({ index: i, start, end, midpoint: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] });
            }
        }
        return edges;
    }

    normalizeCoordinates(coordinates) {
        if (coordinates.length > 3 && this.pointsAreEqual(coordinates[0], coordinates[coordinates.length - 1])) {
            return coordinates.slice(0, -1);
        }
        return coordinates;
    }

    isValidCoordinate(coord) {
        return coord && coord.length >= 2 && typeof coord[0] === 'number' && typeof coord[1] === 'number';
    }

    calculateTerrainBounds(coordinates) {
        if (!coordinates?.length) return null;
        const lngs = coordinates.map(c => c[0]);
        const lats = coordinates.map(c => c[1]);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);

        // buffer ~50m converted to degrees using latitude
        const metersToDeg = (m, lat) => m / (111320 * Math.cos((lat || 0) * Math.PI / 180));
        const latCenter = (minLat + maxLat) / 2;
        const bufferLng = metersToDeg(this.config.defaultBufferMeters, latCenter);
        const bufferLat = this.config.defaultBufferMeters / 111320;

        return {
            bounds: { north: maxLat + bufferLat, south: minLat - bufferLat, east: maxLng + bufferLng, west: minLng - bufferLng },
            center: [(minLng + maxLng) / 2, latCenter],
            zoom: this.calculateOptimalZoom(maxLng - minLng, maxLat - minLat),
            width: maxLng - minLng,
            height: maxLat - minLat,
            timestamp: new Date().toISOString()
        };
    }

    calculateOptimalZoom(width, height) {
        const d = Math.max(width, height);
        if (d > 0.01) return 15;
        if (d > 0.005) return 16;
        if (d > 0.002) return 17;
        if (d > 0.001) return 18;
        return 19;
    }

    // ---------- Emit helpers ----------
    emitBoundaryCreatedEvent(coordinates, metrics) {
        const coordsForCenter = coordinates.slice(0, -1);
        const centerLng = coordsForCenter.reduce((s, c) => s + c[0], 0) / coordsForCenter.length;
        const centerLat = coordsForCenter.reduce((s, c) => s + c[1], 0) / coordsForCenter.length;

        this.emit('site-boundary-created', {
            coordinates,
            area: metrics.area,
            area_m2: metrics.area,
            perimeter: metrics.perimeter,
            edges: metrics.edges,
            center: { lng: centerLng, lat: centerLat },
            center_lng: centerLng,
            center_lat: centerLat,
            type: 'residential',
            terrainBounds: this.calculateTerrainBounds(coordinates)
        });
    }

    emitBoundaryLoadedEvent(coordinates, metrics) {
        const centerLng = coordinates.reduce((s, c) => s + c[0], 0) / coordinates.length;
        const centerLat = coordinates.reduce((s, c) => s + c[1], 0) / coordinates.length;

        this.emit('site-boundary-loaded', {
            coordinates,
            area: metrics.area,
            area_m2: metrics.area,
            perimeter: metrics.perimeter,
            edges: metrics.edges,
            center: { lng: centerLng, lat: centerLat },
            center_lng: centerLng,
            center_lat: centerLat,
            type: 'residential',
            terrainBounds: this.calculateTerrainBounds(coordinates)
        });
    }

    // ---------- Load / legal boundary ----------
    async loadExistingSiteBoundary() {
        try {
            const projectId = this.getProjectIdFromUrl();
            if (!projectId) { this.info('No project ID for boundary loading'); return; }

            // Session restore of legal boundary
            const legalApplied = sessionStorage.getItem('legal_boundary_applied') === 'true';
            const legalCoords = sessionStorage.getItem('legal_boundary_coordinates');

            if (legalApplied && legalCoords) {
                try {
                    const coordinates = JSON.parse(legalCoords);
                    this.loadBoundaryFromCoordinates(coordinates);
                    this.updateLegalBoundaryStroke();
                    this.updateButtonState('useLegalBoundaryButton', 'inactive', 'Legal Property Boundary Applied ✓');
                    setTimeout(() => this.triggerLegalBoundaryWorkflow(), 1000);
                    this.info('Legal boundary restored from session');
                    return;
                } catch (e) { this.warn('Failed to restore legal boundary from session:', e); }
            }

            const response = await fetch(`/api/project/${projectId}/snapshot`);
            if (!response.ok) { this.info('No existing snapshots found'); return; }

            const data = await response.json();
            if (data.success && data.snapshot?.snapshot_data) {
                const snap = JSON.parse(data.snapshot.snapshot_data);
                if (snap.site_coords?.length) {
                    this.loadBoundaryFromCoordinates(snap.site_coords);
                    this.info('Site boundary loaded from snapshot');
                }
            }
        } catch (error) { this.warn('Failed to load existing boundary:', error); }
    }

    loadBoundaryFromCoordinates(coordinates) {
        if (!coordinates || coordinates.length < 3) return;
        try {
            const polygon = this.createPolygonFeature(coordinates);
            try { this.draw?.add?.(polygon); } catch (_) {} // draw may not exist yet
            this.sitePolygon = polygon;

            const metrics = this.calculatePolygonMetrics(coordinates);
            this.polygonEdges = metrics.edges;

            this.updateBoundaryDisplay(metrics.area, metrics.perimeter, coordinates.length - 1);
            this.updateButtonStates(false, true);
            this.showFinalBoundary(coordinates);
            this.showFinalDimensions(coordinates);
            this.isLocked = true;

            this.emitBoundaryLoadedEvent(coordinates, metrics);
        } catch (error) { this.error('Error loading boundary from coordinates:', error); }
    }

    async useLegalPropertyBoundary() {
        try {
            this.info('Using legal property boundary as site boundary');

            // Get the containing property from the map source
            const propertySource = this.map.getSource('property-boundaries');
            if (!propertySource) {
                throw new Error('No property boundaries available on map');
            }

            // Find the containing property feature
            const propertyData = propertySource._data;
            if (!propertyData?.features?.length) {
                throw new Error('No property boundary features found');
            }

            const containingProperty = propertyData.features.find(
                feature => feature.properties.type === 'containing-property'
            );

            if (!containingProperty) {
                throw new Error('No containing property found');
            }

            this.info('Found containing property:', containingProperty.properties);

            // Extract coordinates from the property geometry
            let coordinates;
            if (containingProperty.geometry.type === 'Polygon') {
                coordinates = containingProperty.geometry.coordinates[0];
            } else if (containingProperty.geometry.type === 'MultiPolygon') {
                // Use the first polygon for simplicity
                coordinates = containingProperty.geometry.coordinates[0][0];
            } else {
                throw new Error(`Unsupported geometry type: ${containingProperty.geometry.type}`);
            }

            if (!coordinates || coordinates.length < 4) {
                throw new Error('Invalid property boundary coordinates');
            }

            // Store the legal property boundary separately (keep reference to original legal boundary)
            this.legalPropertyBoundary = this.createPolygonFeature(coordinates);
            this.legalPropertyEdges = this.calculatePolygonEdges(coordinates);

            // IMPORTANT: When using legal boundary as site boundary, we create a NEW site boundary
            // that happens to have the same coordinates, but is treated as user's site boundary
            this.sitePolygon = this.createPolygonFeature(coordinates);
            this.polygonEdges = this.calculatePolygonEdges(coordinates);

            // Set flag to indicate legal boundary was the SOURCE, but now we have a site boundary
            this.legalBoundaryApplied = true;

            // Calculate metrics
            const metrics = this.calculatePolygonMetrics(coordinates);

            // Update UI
            this.updateBoundaryDisplay(metrics.area, metrics.perimeter, coordinates.length - 1);
            this.updateButtonStates(false, true);
            this.showFinalBoundary(coordinates);
            this.showFinalDimensions(coordinates);

            // Store in session for persistence
            sessionStorage.setItem('legal_boundary_applied', 'true');
            sessionStorage.setItem('legal_boundary_coordinates', JSON.stringify(coordinates));
            sessionStorage.setItem('site_boundary_data', JSON.stringify({
                coordinates,
                area: metrics.area,
                perimeter: metrics.perimeter,
                source: 'legal-property-boundary',
                type: 'site-boundary'
            }));

            // Update the legal boundary button state
            this.updateLegalBoundaryButtonState();

            // Clear any drawing state
            this.resetDrawingState();

            // Emit events - this is now a site boundary (that came from legal boundary)
            this.emitBoundaryCreatedEvent(coordinates, metrics);
            window.eventBus?.emit?.('boundary-applied', {
                coordinates,
                area: metrics.area,
                perimeter: metrics.perimeter,
                source: 'legal-property-boundary'
            });

            this.info(`Legal property boundary applied as site boundary: area=${metrics.area.toFixed(2)} m², vertices=${coordinates.length - 1}`);

            // Show success message
            this.showUserSuccess('Legal property boundary applied successfully as site boundary');

        } catch (error) {
            this.error('Failed to use legal property boundary:', error);
            throw error;
        }
    }

    isLocationInNewZealand(lat, lng) {
        const nz = { north: -34.0, south: -47.5, east: 179.0, west: 166.0 };
        return lat >= nz.south && lat <= nz.north && lng >= nz.west && lng <= nz.east;
    }

    processLegalBoundaryCoordinates(coordinates) {
        const out = [];
        for (let i = 0; i < coordinates.length; i++) {
            const coord = coordinates[i];
            if (!Array.isArray(coord) || coord.length < 2) continue;
            const [lng, lat] = [parseFloat(coord[0]), parseFloat(coord[1])];
            if (isNaN(lng) || isNaN(lat)) continue;
            if (!this.isValidCoordinateRange(lng, lat)) continue;
            out.push([lng, lat]);
        }
        if (out.length < 3) throw new Error('Not enough valid coordinates for legal boundary polygon');
        const first = out[0], last = out[out.length - 1];
        if (!this.pointsAreEqual(first, last)) out.push([...first]);
        return out;
    }

    createPolygonFromLegalBoundary(coordinates, propertyInfo) {
        try {
            this.clearDrawingVisualization();
            this.safeDeleteAllFeatures();

            const feature = this.createPolygonFeature(coordinates);
            this.sitePolygon = feature;

            const metrics = this.calculatePolygonMetrics(coordinates);
            this.polygonEdges = metrics.edges;

            this.updateBoundaryDisplay(metrics.area, metrics.perimeter, coordinates.length - 1);
            this.updateButtonStates(true);
            this.showFinalBoundary(coordinates);
            this.showFinalDimensions(coordinates);
            this.updateButtonState('useLegalBoundaryButton', 'inactive', 'Legal Property Boundary Applied ✓');
            this.updateButtonState('drawPolygonButton', 'inactive', 'Draw Site Boundary');

            this.updateLegalBoundaryStroke();
            this.emitBoundaryCreatedEvent(coordinates, metrics);

            setTimeout(() => {
                this.confirmBoundary();
                this.triggerLegalBoundaryWorkflow();
            }, 500);

            sessionStorage.setItem('legal_boundary_applied', 'true');
            sessionStorage.setItem('legal_boundary_coordinates', JSON.stringify(coordinates));
            this.info(`Legal property boundary applied: ${propertyInfo?.title || 'Property'}`);
        } catch (error) {
            this.error('Error creating polygon from legal boundary:', error);
            throw error;
        }
    }

    updateLegalBoundaryStroke() {
        try {
            if (this.map.getLayer('property-boundaries-stroke')) {
                this.map.setPaintProperty('property-boundaries-stroke', 'line-dasharray', [1, 0]);
            }
        } catch (error) { this.error('Error updating legal boundary stroke:', error); }
    }

    triggerLegalBoundaryWorkflow() {
        try { window.eventBus?.emit?.('legal-boundary-applied'); } catch (e) { this.error('Error triggering legal workflow:', e); }
    }

    resetLegalBoundaryButton() {
        try {
            const btn = this.getElementById('useLegalBoundaryButton', false);
            if (btn) {
                btn.textContent = 'Copy Legal Boundary as Site Template';
                btn.classList.remove('active');
                btn.style.background = '';
                this.setupLegalBoundaryButtonState(); // Reapply proper state
                this.info('Legal boundary button reset');
            }
        } catch (error) {
            this.error('Error resetting legal boundary button:', error);
        }
    }

    // ---------- Public API ----------
    getPolygonEdges() { return this.polygonEdges; }
    getSitePolygon() { return this.sitePolygon; }
    isDrawingActive() { return this.isDrawing; }
    hasSiteBoundary() {
        // A site boundary exists if we have a sitePolygon (regardless of its source)
        return !!(this.sitePolygon && this.sitePolygon.geometry && this.sitePolygon.geometry.coordinates);
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

    getSiteData() {
        const siteData = {};
        if (this.hasSiteBoundary()) {
            const coordinates = this.sitePolygon.geometry.coordinates[0];
            const area = this.calculatePolygonArea(coordinates);
            const centerLng = coordinates.reduce((s, c) => s + c[0], 0) / coordinates.length;
            const centerLat = coordinates.reduce((s, c) => s + c[1], 0) / coordinates.length;

            siteData.coordinates = coordinates;
            siteData.area = area;
            siteData.area_m2 = area;
            siteData.center = { lng: centerLng, lat: centerLat };
            siteData.center_lng = centerLng;
            siteData.center_lat = centerLat;
            siteData.type = 'residential';
            siteData.perimeter = this.calculatePolygonPerimeter(coordinates);
            siteData.point_count = coordinates.length - 1;
            siteData.terrainBounds = this.calculateTerrainBounds(coordinates);
        }
        if (this.buildableAreaData) siteData.buildable_area = this.buildableAreaData;
        return siteData;
    }

    getProjectIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        let projectId = urlParams.get('project_id') || urlParams.get('project');
        if (projectId && projectId.includes('?')) projectId = projectId.split('?')[0];
        if (projectId) {
            projectId = String(projectId).trim();
            if (!/^\d+$/.test(projectId)) return null;
        }
        return projectId;
    }

    showUserError(message) {
        if (typeof alert !== 'undefined') alert(message);
        this.error('User error:', message);
    }

    showUserSuccess(message) {
        if (typeof alert !== 'undefined') alert(message); // Consider using a toast or notification system
        this.info('User success:', message);
    }

    // ---------- Destroy ----------
    destroy() {
        try {
            // Run cleanup callbacks
            (this.cleanup || []).forEach(fn => { try { fn(); } catch (_) {} });
        } catch (_) {}
        super.destroy?.();
    }
}

// Make globally available
window.SiteBoundaryCore = SiteBoundaryCore;