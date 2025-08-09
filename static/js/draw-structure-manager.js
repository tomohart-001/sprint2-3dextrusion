
/**
 * Draw Structure Manager - Reliable structure drawing on Mapbox Draw
 * Simplified: rely solely on Mapbox-Draw for interactions (no parallel preview stack)
 */

// Ensure BaseManager is available or provide fallback
if (typeof BaseManager === 'undefined') {
    console.warn('[DrawStructureManager] BaseManager not available, using fallback');
    window.BaseManager = class {
        constructor(name) { this.name = name; }
        info(...args) { console.log(`[${this.name}] INFO:`, ...args); }
        warn(...args) { console.warn(`[${this.name}] WARN:`, ...args); }
        error(...args) { console.error(`[${this.name}] ERROR:`, ...args); }
        debug(...args) { console.debug?.(`[${this.name}] DEBUG:`, ...args); }
    };
}

if (typeof DrawStructureManager === 'undefined') {
    window.DrawStructureManager = class DrawStructureManager extends BaseManager {
        constructor(map, floorplanManager) {
            super('DrawStructureManager');

            if (!map) throw new Error('Map instance is required for DrawStructureManager');
            if (!floorplanManager) throw new Error('FloorplanManager instance is required for DrawStructureManager');

            this.map = map;
            this.floorplanManager = floorplanManager;

            this.draw = null;
            this.isDrawing = false;

            // keep lightweight state to preserve API
            this.state = {
                isDrawing: false,
                drawingPoints: [],
                currentDrawMode: null
            };

            // listener references so we can safely remove them
            this._onCreate = null;
            this._onUpdate = null;
            this._onDelete = null;
            this._onStyle = null;

            this._initAttempts = 0;
            this._maxInitAttempts = 20;
            this._retryTimer = null;
        }

        async initialize() {
            this.info('Initializing Draw Structure Manager...');
            try {
                await this._attachDrawControl();
                this._wireCoreListeners();
                this.info('✅ Draw Structure Manager initialized successfully');
            } catch (err) {
                this.error('Failed to initialize DrawStructureManager:', err);
                throw err;
            }
        }

        /**
         * Try to obtain the Mapbox Draw instance from a shared core (siteInspectorCore).
         * Retries briefly because core may finish after this manager.
         */
        _attachDrawControl() {
            return new Promise((resolve, reject) => {
                const tryAttach = () => {
                    const core = window.siteInspectorCore;
                    if (core?.draw) {
                        this.draw = core.draw;
                        this.debug('Draw control attached');
                        return true;
                    }
                    return false;
                };

                if (tryAttach()) return resolve();

                this.debug('Draw control not ready, will retry...');
                this._retryTimer = setInterval(() => {
                    this._initAttempts += 1;
                    if (tryAttach()) {
                        clearInterval(this._retryTimer);
                        this._retryTimer = null;
                        resolve();
                    } else if (this._initAttempts >= this._maxInitAttempts) {
                        clearInterval(this._retryTimer);
                        this._retryTimer = null;
                        this.warn('Draw control not available after maximum retries');
                        reject(new Error('Mapbox Draw not available'));
                    }
                }, 250);
            });
        }

        /**
         * Wire draw + map listeners exactly once.
         */
        _wireCoreListeners() {
            if (!this.map || !this.draw) return;

            // Remove previous if any (idempotent)
            this._unwireCoreListeners();

            this._onCreate = (e) => this._handleCreate(e);
            this._onUpdate = (e) => this._handleUpdate(e);
            this._onDelete = (e) => this._handleDelete(e);

            this.map.on('draw.create', this._onCreate);
            this.map.on('draw.update', this._onUpdate);
            this.map.on('draw.delete', this._onDelete);

            // If the style reloads, Draw rebinds its layers — ensure our session keeps working
            this._onStyle = () => {
                if (this.isDrawing && this.draw?.getMode?.() !== 'draw_polygon') {
                    // When style reloads, some versions of Mapbox-Draw flip mode; force back to draw mode
                    this.debug('Style reloaded while drawing; restoring draw mode');
                    try { this.draw.changeMode('draw_polygon'); } catch (_) {}
                }
            };
            this.map.on('styledata', this._onStyle);

            this.debug('Core listeners wired');
        }

        _unwireCoreListeners() {
            if (!this.map) return;
            if (this._onCreate) this.map.off('draw.create', this._onCreate);
            if (this._onUpdate) this.map.off('draw.update', this._onUpdate);
            if (this._onDelete) this.map.off('draw.delete', this._onDelete);
            if (this._onStyle) this.map.off('styledata', this._onStyle);
            this._onCreate = this._onUpdate = this._onDelete = this._onStyle = null;
        }

        /**
         * Public API
         */
        startDrawing() {
            if (!this._validateReady()) return;

            try {
                this.info('Starting structure drawing mode...');
                // Notify other modules
                window.eventBus?.emit?.('tool-activated', 'floorplan');

                // Clear any existing structure viz
                this.floorplanManager?.removeStructureVisualization?.();

                // Reset state
                this.isDrawing = true;
                this.state.isDrawing = true;
                this.state.drawingPoints = [];
                this.state.currentDrawMode = 'draw_polygon';

                // Ensure style is ready-ish; Draw will handle queuing clicks
                if (!this.map.isStyleLoaded()) {
                    this.warn('Map style not fully loaded yet; drawing will begin as soon as it is ready.');
                }

                // Enter polygon drawing mode
                this.draw.changeMode('draw_polygon');

                // UI niceties
                this._setCursor('crosshair');
                this.floorplanManager?.updateDrawingUI?.(true);
                this.floorplanManager?.showStatus?.('Click to place vertices. Double‑click to finish.', 'info');

                this.info('✅ Structure drawing mode started');
            } catch (error) {
                this.error('Failed to start structure drawing mode:', error);
                this._resetDrawingState();
                this.floorplanManager?.showStatus?.('Failed to start drawing mode: ' + (error.message || 'Unknown error'), 'error');
            }
        }

        stopDrawing() {
            try {
                if (!this.draw) return;
                this.isDrawing = false;
                this.state.isDrawing = false;
                this.state.drawingPoints = [];
                this.state.currentDrawMode = null;

                // Back to select mode safely
                if (this.draw.getMode?.() !== 'simple_select') {
                    this.draw.changeMode('simple_select');
                }

                // UI reset
                this._setCursor('');
                this.floorplanManager?.updateDrawingUI?.(false);

                this.info('Structure drawing mode stopped');
            } catch (error) {
                this.error('Failed to stop structure drawing mode:', error);
                this._resetDrawingState();
            }
        }

        toggleDrawing() {
            if (this.isDrawing) this.stopDrawing();
            else this.startDrawing();
        }

        isDrawingActive() { return this.isDrawing; }

        getDrawingPoints() {
            // We no longer track parallel points; keep API but return empty (Draw is the source of truth)
            return this.state.drawingPoints.slice();
        }

        /**
         * Draw events
         */
        _handleCreate(e) {
            try {
                const feature = e?.features?.[0];
                if (!feature || feature.geometry?.type !== 'Polygon') {
                    this.debug('draw.create ignored (not a polygon)');
                    return;
                }

                // Be explicit about coordinates
                const ring = (feature.geometry.coordinates && feature.geometry.coordinates[0]) || [];
                if (ring.length < 4) { // polygon rings are closed, so <4 means <3 unique vertices
                    this.warn('Polygon creation had insufficient vertices');
                    return;
                }

                this.info('Structure created via Draw:', feature);

                // Build final feature (ensure clean properties)
                const structureFeature = {
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [ring] },
                    properties: {
                        type: 'structure',
                        name: 'Structure Footprint',
                        layer_type: 'structure_footprint'
                    }
                };

                // Remove from Draw so edits are owned by our own manager
                if (this.draw && feature.id != null) {
                    try { this.draw.delete([feature.id]); } catch (delErr) { this.warn('Failed to delete temp draw feature', delErr); }
                }

                // Update floorplan manager
                if (this.floorplanManager) {
                    this.floorplanManager.currentStructure = structureFeature;
                    if (this.floorplanManager.state) {
                        this.floorplanManager.state.geojsonPolygon = structureFeature;
                        this.floorplanManager.state.hasFloorplan = true;
                    }
                    // Add visualization
                    this.floorplanManager.addStructureVisualization?.(structureFeature);

                    // Area calc
                    const area = this._calculateAreaSafe([ring]);
                    this.floorplanManager.updateStructureControls?.(true);
                    this.floorplanManager.showStatus?.(`Structure created (${area.toFixed(1)} m²)`, 'success');
                }

                // Exit drawing mode
                this.stopDrawing();

                // Emit event
                window.eventBus?.emit?.('structure-created', {
                    feature: structureFeature,
                    area: this._calculateAreaSafe([ring]),
                    coordinates: ring,
                    type: 'structure'
                });
            } catch (error) {
                this.error('Error handling structure creation:', error);
                this.floorplanManager?.showStatus?.('Error creating structure', 'error');
                // Try to exit gracefully
                this.stopDrawing();
            }
        }

        _handleUpdate(_e) {
            // We keep creation-only flow for simplicity.
            // If you later enable vertex editing, wire this to update visualization.
            this.debug('draw.update event received (no-op)');
        }

        _handleDelete(_e) {
            this.info('Structure deleted via Draw (or temp feature removed)');
            this.floorplanManager?.clearStructureState?.();
            this.floorplanManager?.updateStructureControls?.(false);
            window.eventBus?.emit?.('structure-deleted');
        }

        /**
         * Utilities
         */
        _validateReady() {
            if (!this.map) {
                this.error('Map instance not available');
                this.floorplanManager?.showStatus?.('Map not ready for drawing', 'error');
                return false;
            }
            if (!this.floorplanManager) {
                this.error('FloorplanManager instance not available');
                return false;
            }
            if (!this.draw) {
                const core = window.siteInspectorCore;
                if (core?.draw) {
                    this.draw = core.draw;
                    this.info('Draw control obtained from siteInspectorCore');
                } else {
                    this.error('Draw control not available');
                    this.floorplanManager?.showStatus?.('Drawing tools not ready. Please refresh the page.', 'error');
                    return false;
                }
            }
            if (typeof this.draw.changeMode !== 'function') {
                this.error('Draw control not properly initialized (missing changeMode)');
                this.floorplanManager?.showStatus?.('Drawing tools are not ready. Please refresh the page.', 'error');
                return false;
            }
            return true;
        }

        _setCursor(cursor) {
            try { this.map.getCanvas()?.style && (this.map.getCanvas().style.cursor = cursor || ''); }
            catch (_) {}
        }

        _resetDrawingState() {
            this.isDrawing = false;
            this.state.isDrawing = false;
            this.state.drawingPoints = [];
            this.state.currentDrawMode = null;
            this._setCursor('');
            try {
                if (this.draw?.getMode?.() !== 'simple_select') this.draw.changeMode('simple_select');
            } catch (_) {}
        }

        _calculateAreaSafe(coordinates) {
            // coordinates must be an array of linear rings: [ [ [lng,lat], ... ] ]
            try {
                if (window.turf?.area) {
                    const poly = window.turf.polygon(coordinates);
                    const area = window.turf.area(poly);
                    return Number.isFinite(area) ? area : 0;
                }
            } catch (e) {
                this.warn('Turf area calculation failed, falling back', e);
            }

            // Fallback: planar-ish approximation (better than nothing)
            try {
                const ring = coordinates[0] || [];
                if (ring.length < 4) return 0;
                let a = 0;
                for (let i = 0; i < ring.length - 1; i++) {
                    const [x1, y1] = ring[i];
                    const [x2, y2] = ring[i + 1];
                    a += (x1 * y2 - x2 * y1);
                }
                a = Math.abs(a) / 2;
                // crude conversion to m²
                const lat = (ring[0]?.[1]) || 0;
                const mPerDegX = 111320 * Math.cos(lat * Math.PI / 180);
                const mPerDegY = 110540;
                return a * mPerDegX * mPerDegY;
            } catch {
                return 0;
            }
        }

        // Cleanup method
        cleanup() {
            if (this._retryTimer) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
            }
            this._unwireCoreListeners();
            this._resetDrawingState();
            this.info('Draw Structure Manager cleaned up');
        }
    };

    // Make available globally
    window.DrawStructureManager = DrawStructureManager;
}