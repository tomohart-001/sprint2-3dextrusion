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
            this.drawStructureManager = null;

            this.isDrawing = false;
            this.structures = [];
            this.currentStructure = null;

            this.state = {
                hasFloorplan: false,
                geojsonPolygon: null,
                currentDrawMode: null,
                isExtruded: false,
                drawingPoints: []
            };

            this.drawButton = null;
            this.clearButton = null;
            this.statusDisplay = null;
            this.extrudeButton = null;
            this.stopButton = null;
        }

        async initialize() {
            this.info('Initializing Floorplan Manager...');
            if (!this.map) throw new Error('Map instance required for FloorplanManager');

            this.drawButton =
                document.getElementById('drawFloorplanButton') ||
                document.getElementById('drawStructureButton') ||
                document.querySelector('[data-action="draw-structure"]') ||
                document.querySelector('.draw-structure-btn') ||
                document.querySelector('#floorplanCard .draw-button');

            this.clearButton =
                document.getElementById('clearStructuresButton') ||
                document.getElementById('clearFloorplanButton');

            this.extrudeButton = document.getElementById('extrudeStructureButton');
            this.stopButton = document.getElementById('stopStructureDrawingButton');

            if (typeof DrawStructureManager !== 'undefined') {
                this.drawStructureManager = new DrawStructureManager(this.map, this);
                await this.drawStructureManager.initialize();
                this.info('DrawStructureManager initialized');
            } else {
                this.warn('DrawStructureManager class not found. Using fallback.');
                this.setupDrawEventHandlersFallback();
            }

            this.setupEventHandlers();
            this.isDrawing = false;
            this.structures = [];
            this.updateStructureControls(false);
            this.info('✅ Floorplan Manager initialized successfully');
        }

        setupEventHandlers() {
            this.info('Setting up event handlers...');
            this.setupDrawButtonListener();

            if (!this.drawButton) {
                this.warn('Draw structure button not found in DOM - checking alternatives...');
                const altButtons = [
                    document.querySelector('#drawFloorplanButton'),
                    document.querySelector('.draw-button'),
                    document.querySelector('.draw-structure-btn'),
                    document.querySelector('[onclick*="draw"]'),
                    document.querySelector('.btn[data-action="draw-structure"]'),
                    document.querySelector('#floorplanControls .draw-button'),
                    document.querySelector('#floorplanCard .btn:first-child')
                ];
                for (let btn of altButtons) {
                    if (btn) {
                        this.drawButton = btn;
                        this.setupDrawButtonListener();
                        this.info('✅ Found alternative draw button');
                        break;
                    }
                }
                if (!this.drawButton) this.error('No draw structure button found');
            }

            if (this.stopButton) {
                this.stopButton.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    this.stopDrawing();
                });
            }
            if (this.clearButton) {
                this.clearButton.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    this.clearStructure();
                });
            }
            if (this.extrudeButton) {
                this.extrudeButton.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    this.extrudeStructure();
                });
            }

            if (this.drawStructureManager) {
                this.drawStructureManager.setupDrawEventHandlers();
            } else {
                this.setupDrawEventHandlersFallback();
            }

            window.eventBus?.on?.('tool-activated', toolName => {
                if (toolName !== 'floorplan' && this.isDrawingActive()) {
                    this.info(`Other tool '${toolName}' activated, stopping structure drawing`);
                    this.stopDrawing();
                }
            });
        }

        setupDrawButtonListener() {
            if (this.drawButton) {
                this.drawButton.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    this.info('Draw structure button clicked');
                    this.toggleDrawingMode();
                });
                this.info('✅ Draw structure button listener attached');
            }
        }

        setupDrawEventHandlersFallback() {
            this.info('Setting up fallback draw event handlers...');
            const checkDraw = () => {
                const core = window.siteInspectorCore;
                if (core?.draw) {
                    this.draw = core.draw;
                    this.map.on('draw.create', e => this.handleStructureCreated(e));
                    this.map.on('draw.update', e => this.handleStructureUpdated(e));
                    this.map.on('draw.delete', e => this.handleStructureDeleted(e));
                    return true;
                }
                return false;
            };
            if (!checkDraw()) {
                let attempts = 0;
                const retryInterval = setInterval(() => {
                    attempts++;
                    if (checkDraw() || attempts >= 20) clearInterval(retryInterval);
                }, 250);
            }
        }

        toggleDrawingMode() {
            if (this.drawStructureManager?.toggleDrawing) {
                this.drawStructureManager.toggleDrawing();
            } else {
                if (this.isDrawing) this.stopDrawing();
                else this.startDrawing();
            }
        }

        startDrawing() {
            if (this.drawStructureManager?.startDrawing) {
                this.drawStructureManager.startDrawing();
            } else {
                this.isDrawing = true;
                this.updateDrawButton(true);
                this.showStatus('Click on the map to start drawing structure footprint', 'info');
                window.eventBus?.emit?.('tool-activated', 'floorplan');
            }
        }

        stopDrawing() {
            if (this.drawStructureManager?.stopDrawing) {
                this.drawStructureManager.stopDrawing();
            } else {
                this.isDrawing = false;
                this.updateDrawButton(false);
                this.showStatus('Drawing stopped', 'info');
            }
        }

        // ... [rest of your methods remain unchanged except emits → optional chaining] ...

        handleStructureCreated(e) {
            try {
                const feature = e.features[0];
                if (!feature || feature.geometry.type !== 'Polygon') return;
                this.currentStructure = {
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [feature.geometry.coordinates[0]] },
                    properties: { type: 'structure', name: 'Structure Footprint' }
                };
                this.state.geojsonPolygon = this.currentStructure;
                this.state.hasFloorplan = true;

                const area = this.calculatePolygonArea(feature.geometry.coordinates[0]);
                this.addStructureVisualization(this.currentStructure);
                this.showStatus(`Structure created (${area.toFixed(1)} m²)`, 'success');
                this.updateStructureControls(true);
                this.stopDrawing();
                window.eventBus?.emit?.('structure-created', {
                    feature: this.currentStructure, area, coordinates: feature.geometry.coordinates[0], type: 'structure'
                });
            } catch (err) {
                this.error('Error handling structure creation:', err);
            }
        }

        handleStructureDeleted() {
            this.clearStructureState();
            this.updateStructureControls(false);
            this.showStatus('Structure deleted', 'info');
            window.eventBus?.emit?.('structure-deleted');
        }

        extrudeStructure() {
            const height = parseFloat(prompt('Enter extrusion height (in meters):'));
            if (isNaN(height) || height <= 0) {
                this.showStatus('Invalid height entered.', 'error');
                return;
            }
            if (!this.currentStructure) {
                this.showStatus('No structure to extrude.', 'warning');
                return;
            }
            // ... same logic ...
            window.eventBus?.emit?.('extrusion-applied', { height, coordinates: this.currentStructure.geometry.coordinates[0] });
        }

        cleanup() {
            this.drawStructureManager?.cleanup?.();
            this.info('FloorplanManager cleanup complete.');
        }
    };
}