/**
 * Extrusion 3D Manager
 * Handles 3D building extrusion functionality
 */

// Ensure BaseManager is available or provide fallback
if (typeof BaseManager === 'undefined') {
    console.warn('[Extrusion3DManager] BaseManager not available, using fallback');
    window.BaseManager = class {
        constructor(name) { this.name = name; }
        info(...args)  { console.log(`[${this.name}] INFO:`, ...args); }
        warn(...args)  { console.warn(`[${this.name}] WARN:`, ...args); }
        error(...args) { console.error(`[${this.name}] ERROR:`, ...args); }
        debug(...args) { console.debug?.(`[${this.name}] DEBUG:`, ...args); }
    };
}

class Extrusion3DManager extends BaseManager {
    constructor(map) {
        super('Extrusion3DManager');
        this.map = map;

        // State
        this.activeExtrusions = new Map(); // id -> Feature (GeoJSON)
        this.defaultHeight = 9; // meters
        this.is3DViewEnabled = false;

        // IDs (single shared source/layer for all extrusions)
        this.SRC_ID = 'building-extrusions';
        this.LYR_ID = 'building-extrusion-layer';

        // Listener references for cleanup
        this._onSBDeleted = null;
        this._onClearDeps = null;
        this._onClearAll = null;
    }

    async initialize() {
        try {
            this.info('Initializing 3D Extrusion Manager...');

            if (!this.map) throw new Error('Map instance required for 3D extrusions');

            // Ensure base source/layer exist early (ok if style not fully loaded; we re-check later)
            this.ensureExtrusionSourceAndLayer();

            // UI + bus listeners
            this.setupUIEventListeners();
            this.setupEventListeners();

            this.info('✅ Extrusion3DManager initialized successfully');
            return true;
        } catch (error) {
            this.error('Failed to initialize Extrusion3DManager:', error);
            throw error;
        }
    }

    /* -----------------------------
       Event wiring
    ------------------------------ */
    setupEventListeners() {
        const bus = window.eventBus;
        if (!bus?.on) {
            this.warn('eventBus not available; skipping extrusion listeners');
            return;
        }

        this._onSBDeleted = () => {
            this.info('Site boundary deleted - clearing all 3D extrusions');
            this.clearAllExtrusions();
        };
        this._onClearDeps = () => {
            this.info('Comprehensive clearing - removing all 3D extrusions');
            this.clearAllExtrusions();
        };
        this._onClearAll = () => {
            this.info('Complete site data clearing requested - removing all 3D extrusions');
            this.clearAllExtrusions();
        };

        bus.on('site-boundary-deleted', this._onSBDeleted);
        bus.on('clear-all-dependent-features', this._onClearDeps);
        bus.on('clear-all-site-data', this._onClearAll);
    }

    setupUIEventListeners() {
        // Structure extrusion button (primary action)
        const extrudeStructureButton = document.getElementById('extrudeStructureButton');
        extrudeStructureButton?.addEventListener('click', () => {
            try {
                this.extrudeStructureFootprint();
            } catch (error) {
                this.error('Structure extrusion failed:', error);
                alert('Failed to extrude structure: ' + error.message);
            }
        });

        // 3D view toggle button
        const toggle3DViewButton = document.getElementById('toggle3DViewButton');
        toggle3DViewButton?.addEventListener('click', () => this.toggle3DView());

        // Remove all 3D models button
        const removeAll3DBtn = document.getElementById('removeAll3DBtn');
        removeAll3DBtn?.addEventListener('click', () => this.removeAllExtrusions());

        this.info('UI event listeners setup completed');
    }

    /* -----------------------------
       Core helpers
    ------------------------------ */
    ensureExtrusionSourceAndLayer() {
        try {
            // Source
            if (!this.map.getSource?.(this.SRC_ID)) {
                this.map.addSource(this.SRC_ID, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
            }

            // Layer
            if (!this.map.getLayer?.(this.LYR_ID)) {
                this.map.addLayer({
                    id: this.LYR_ID,
                    type: 'fill-extrusion',
                    source: this.SRC_ID,
                    paint: {
                        'fill-extrusion-color': ['get', 'color'],
                        'fill-extrusion-height': ['get', 'height'],
                        'fill-extrusion-base': ['get', 'base'],
                        'fill-extrusion-opacity': ['get', 'opacity']
                    }
                });
            }
        } catch (err) {
            // Style might not be loaded yet; Mapbox will throw.
            this.debug('Could not ensure source/layer yet (style not ready?)', err.message);
        }
    }

    updateExtrusionsSource() {
        try {
            // Make sure base source/layer exist before update
            this.ensureExtrusionSourceAndLayer();

            const source = this.map.getSource(this.SRC_ID);
            if (source?.setData) {
                const features = Array.from(this.activeExtrusions.values());
                source.setData({ type: 'FeatureCollection', features });
            }
        } catch (error) {
            this.error('Failed to update extrusions source:', error);
        }
    }

    /* -----------------------------
       Public actions
    ------------------------------ */
    clearAllExtrusions() {
        try {
            // Delegate to single-path implementation and reset camera
            this.removeAllExtrusions();

            this.map?.easeTo?.({
                pitch: 0,
                bearing: 0,
                duration: 1000
            });

            this.info('All 3D extrusions cleared');
        } catch (error) {
            this.error('Error clearing all extrusions:', error);
        }
    }

    extrudeStructureFootprint() {
        try {
            // Height: UI input -> property setbacks -> default
            const heightInput = document.getElementById('structureHeightInput');
            let height = parseFloat(heightInput?.value);
            if (!Number.isFinite(height) || height <= 0) {
                const psm = window.siteInspectorCore?.propertySetbacksManager;
                const limit = psm?.getCurrentHeightLimit?.();
                height = Number.isFinite(limit) && limit > 0 ? limit : 12;
            }

            // Get structure footprint from floorplan manager
            const fm = window.siteInspectorCore?.floorplanManager;
            if (!fm) throw new Error('Floorplan manager not available');

            let structureCoords =
                fm.getCurrentFloorplanCoordinates?.() ||
                (fm.currentStructure?.geometry?.coordinates?.[0]) ||
                (fm.state?.geojsonPolygon?.geometry?.coordinates?.[0]);

            if (!structureCoords || structureCoords.length === 0) {
                throw new Error('No structure footprint available. Please draw a structure first using the Floor Plan tools.');
            }

            // Normalize to [lng, lat]
            const coordinates = structureCoords.map((c) => [c[0], c[1]]);

            const extrusionId = this.extrudePolygon(coordinates, height, {
                color: '#ff6b35',
                opacity: 0.9,
                type: 'structure',
                extrusionType: 'structure'
            });

            this.showExtrusionStatus(`3D structure created (${height}m height)`, 'success');
            this.updateActiveExtrusionsDisplay();

            // Emit event
            window.eventBus?.emit?.('extrusion-applied', {
                type: 'structure',
                height,
                extrusionId,
                coordinates
            });

            return extrusionId;
        } catch (error) {
            this.error('Failed to extrude structure footprint:', error);
            this.showExtrusionStatus(`Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Create or update a 3D extrusion from a polygon
     */
    extrudePolygon(polygonCoords, height = this.defaultHeight, properties = {}) {
        try {
            if (!Array.isArray(polygonCoords) || polygonCoords.length < 3) {
                throw new Error('Invalid polygon coordinates for extrusion');
            }

            // Close ring if needed
            const coords = polygonCoords.slice();
            const first = coords[0];
            const last = coords[coords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);

            const extrusionId = `extrusion_${Date.now()}`;

            const feature = {
                type: 'Feature',
                id: extrusionId,
                geometry: { type: 'Polygon', coordinates: [coords] },
                properties: {
                    height,
                    base: 0,
                    color: properties.color || '#8B4513',
                    opacity: properties.opacity ?? 0.8,
                    extrusionType: properties.type || 'generic',
                    ...properties
                }
            };

            // Track & render
            this.activeExtrusions.set(extrusionId, feature);
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
            if (this.activeExtrusions.delete(extrusionId)) {
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
     * Remove all extrusions (keeps source/layer; empties data)
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
            const f = this.activeExtrusions.get(extrusionId);
            if (f) {
                f.properties.height = newHeight;
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
     * Active extrusions UI
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

            const items = Array.from(this.activeExtrusions.entries()).map(([id, data]) => {
                const type = data.properties.extrusionType || 'generic';
                const height = data.properties.height || 0;
                const typeLabel =
                    type === 'buildable_area' ? 'Buildable Area' :
                    type === 'structure'     ? 'Structure'     : 'Building';

                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
                        <span>${typeLabel}: ${height}m</span>
                        <button onclick="window.siteInspectorCore?.extrusion3DManager?.removeExtrusion('${id}')"
                                style="background:#dc3545;color:#fff;border:none;padding:2px 6px;border-radius:4px;font-size:10px;">
                            Remove
                        </button>
                    </div>
                `;
            }).join('');

            extrusionsList.innerHTML = items;
        } else {
            activeExtrusionsDisplay.style.display = 'none';
            if (removeAll3DBtn) removeAll3DBtn.style.display = 'none';
            extrusionsList.innerHTML = '';
        }
    }

    hasActiveExtrusions() {
        return this.activeExtrusions.size > 0;
    }

    getActiveExtrusions() {
        return Array.from(this.activeExtrusions.entries()).map(([id, data]) => ({ id, ...data }));
    }

    /**
     * Toggle 3D view
     */
    toggle3DView() {
        try {
            const button = document.getElementById('toggle3DViewButton');

            if (this.is3DViewEnabled) {
                this.map?.easeTo?.({ pitch: 0, bearing: 0, duration: 1000 });
                this.is3DViewEnabled = false;
                if (button) button.textContent = 'Enable 3D View';
                this.info('3D view disabled');
            } else {
                this.map?.easeTo?.({ pitch: 45, bearing: -17.6, duration: 1000 });
                this.is3DViewEnabled = true;
                if (button) button.textContent = 'Disable 3D View';
                this.info('3D view enabled');
            }
        } catch (error) {
            this.error('Failed to toggle 3D view:', error);
        }
    }

    /**
     * Status helper
     */
    showExtrusionStatus(message, type = 'info') {
        const el = document.getElementById('extrusionStatus');
        if (!el) return;
        el.textContent = message;
        el.className = `floorplan-status ${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        try {
            // Unwire bus listeners
            const bus = window.eventBus;
            if (bus?.off) {
                if (this._onSBDeleted) bus.off('site-boundary-deleted', this._onSBDeleted);
                if (this._onClearDeps) bus.off('clear-all-dependent-features', this._onClearDeps);
                if (this._onClearAll) bus.off('clear-all-site-data', this._onClearAll);
            }
            this._onSBDeleted = this._onClearDeps = this._onClearAll = null;

            // Keep source/layer around (harmless), just clear data
            this.activeExtrusions.clear();
            this.updateExtrusionsSource();

            this.info('Extrusion3DManager cleaned up');
        } catch (error) {
            this.error('Error during cleanup:', error);
        }
    }
}

// Make it globally available
window.Extrusion3DManager = Extrusion3DManager;