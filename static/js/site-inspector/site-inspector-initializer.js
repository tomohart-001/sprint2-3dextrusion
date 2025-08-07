
/**
 * Site Inspector Initializer
 * Handles initialization logic for the site inspector
 */

class SiteInspectorInitializer extends BaseManager {
    constructor(core) {
        super('SiteInspectorInitializer');
        this.core = core;
    }

    async initialize() {
        // Validate required dependencies first
        if (!this.validateDependencies()) {
            throw new Error('Required dependencies not available');
        }

        // Load site data from template
        this.core.loadSiteData();

        // Load project address FIRST before map initialization
        const addressLoaded = await this.core.loadProjectAddress();

        if (!addressLoaded) {
            this.warn('⚠️ Project address could not be loaded, proceeding with default location');
            if (!this.core.siteData.center) {
                this.core.siteData.center = {
                    lat: -36.8485,
                    lng: 174.7633
                };
                this.info('Using default Auckland location for map center');
            }
        }

        // Always initialize map - this is critical for site inspector functionality
        await this.initializeMap();

        // Initialize all managers with error handling
        await this.initializeManagers();

        // Setup inter-manager communication
        this.core.setupEventHandlers();

        this.core.isInitialized = true;

        // Hide loading state
        const mapLoading = document.getElementById('mapLoading');
        if (mapLoading) {
            mapLoading.style.display = 'none';
        }

        this.info('✅ Site Inspector initialization completed successfully');
    }

    validateDependencies() {
        return typeof mapboxgl !== 'undefined';
    }

    async initializeMap() {
        this.info('Initializing Mapbox map...');

        try {
            const mapContainer = document.getElementById('inspectorMap');
            if (!mapContainer) {
                throw new Error('Map container element not found');
            }

            if (typeof mapboxgl === 'undefined') {
                throw new Error('MapboxGL library not loaded - check CDN connection');
            }

            if (typeof MapboxDraw === 'undefined') {
                this.warn('MapboxDraw library not loaded - drawing features will be limited');
            }

            let tokenData;
            try {
                tokenData = await this.getMapboxTokenWithRetry();
            } catch (tokenError) {
                this.error('Failed to get Mapbox token after retries:', tokenError);
                throw new Error('Unable to authenticate with Mapbox services');
            }

            mapboxgl.accessToken = tokenData.token;
            this.info('✅ Mapbox token set successfully');

            let center = [174.7762, -41.2865]; // Default Wellington fallback
            let zoom = 13; // Default zoom

            if (this.core.siteData.center && this.core.siteData.center.lat && this.core.siteData.center.lng) {
                center = [this.core.siteData.center.lng, this.core.siteData.center.lat];
                zoom = 17; // Higher zoom for specific locations
                this.info('✅ Using project location for map center:', center, 'for address:', this.core.siteData.project_address);
            } else {
                this.warn('⚠️ No project coordinates available, using Wellington fallback:', center);

                if (window.projectData && window.projectData.address && !this.core.siteData.project_address) {
                    this.info('📍 Attempting to geocode project address from template data...');
                    setTimeout(async () => {
                        const geocoded = await this.core.geocodeProjectAddress(window.projectData.address);
                        if (geocoded && this.core.siteData.center) {
                            this.core.map.flyTo({
                                center: [this.core.siteData.center.lng, this.core.siteData.center.lat],
                                zoom: 17,
                                essential: true
                            });
                            this.info('✅ Map recentered to project location after geocoding');
                        }
                    }, 1000);
                }
            }

            this.core.map = new mapboxgl.Map({
                container: 'inspectorMap',
                style: 'mapbox://styles/mapbox/outdoors-v12',
                center: center,
                zoom: zoom,
                pitch: 0,
                bearing: 0,
                attributionControl: false,
                logoPosition: 'bottom-left',
                maxZoom: 22,
                minZoom: 8
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Map loading timeout'));
                }, 15000);

                this.core.map.on('load', () => {
                    clearTimeout(timeout);
                    this.setupMapControls();
                    this.setup3DTerrain();
                    this.info('Map loaded successfully');
                    resolve();
                });

                this.core.map.on('error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`Map error: ${e.error?.message || 'Unknown map error'}`));
                });
            });

        } catch (error) {
            this.error('Failed to initialize map:', error);
            throw error;
        }
    }

    async initializeDrawControl() {
        this.info('Creating MapboxDraw instance...');

        if (typeof MapboxDraw === 'undefined') {
            this.warn('MapboxDraw not available - drawing features will be limited');
            this.core.draw = null;
            return;
        }

        try {
            if (!this.core.map.isStyleLoaded()) {
                this.info('Waiting for map style to load before initializing draw...');
                return new Promise((resolve) => {
                    this.core.map.once('styledata', async () => {
                        try {
                            await this.initializeDrawControl();
                            resolve();
                        } catch (error) {
                            this.error('Error in deferred draw initialization:', error);
                            resolve();
                        }
                    });
                });
            }

            const config = window.SiteInspectorConfig;

            try {
                this.core.draw = new MapboxDraw({
                    displayControlsDefault: false,
                    controls: {},
                    defaultMode: 'simple_select',
                    styles: [
                        {
                            'id': 'gl-draw-polygon-fill-inactive',
                            'type': 'fill',
                            'filter': ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                            'paint': {
                                'fill-color': config.get('colors.primary'),
                                'fill-opacity': config.get('drawing.previewOpacity')
                            }
                        },
                        {
                            'id': 'gl-draw-polygon-stroke-inactive',
                            'type': 'line',
                            'filter': ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                            'paint': {
                                'line-color': config.get('colors.primary'),
                                'line-width': config.get('drawing.lineWidth')
                            }
                        },
                        {
                            'id': 'gl-draw-polygon-fill-active',
                            'type': 'fill',
                            'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
                            'paint': {
                                'fill-color': config.get('colors.primary'),
                                'fill-opacity': config.get('drawing.previewOpacity') + 0.1
                            }
                        },
                        {
                            'id': 'gl-draw-polygon-stroke-active',
                            'type': 'line',
                            'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
                            'paint': {
                                'line-color': config.get('colors.primary'),
                                'line-width': config.get('drawing.activeLineWidth')
                            }
                        },
                        {
                            'id': 'gl-draw-line-active',
                            'type': 'line',
                            'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'LineString']],
                            'paint': {
                                'line-color': config.get('colors.primary'),
                                'line-width': config.get('drawing.activeLineWidth'),
                                'line-dasharray': [2, 2]
                            }
                        },
                        {
                            'id': 'gl-draw-point-active',
                            'type': 'circle',
                            'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Point']],
                            'paint': {
                                'circle-radius': 6,
                                'circle-color': config.get('colors.primary'),
                                'circle-stroke-color': '#ffffff',
                                'circle-stroke-width': 2
                            }
                        },
                        {
                            'id': 'gl-draw-point-inactive',
                            'type': 'circle',
                            'filter': ['all', ['==', 'active', 'false'], ['==', '$type', 'Point']],
                            'paint': {
                                'circle-radius': 4,
                                'circle-color': config.get('colors.primary'),
                                'circle-stroke-color': '#ffffff',
                                'circle-stroke-width': 2
                            }
                        }
                    ]
                });
            } catch (constructorError) {
                this.error('Failed to construct MapboxDraw instance:', constructorError);
                this.core.draw = null;
                return;
            }

            this.info('Adding Draw control to map...');
            
            try {
                await new Promise(resolve => setTimeout(resolve, 100));
                
                if (!this.core.map || !this.core.map.getContainer()) {
                    throw new Error('Map is no longer valid');
                }
                
                this.core.map.addControl(this.core.draw);
                
                await new Promise(resolve => setTimeout(resolve, 200));
                
                this.info('✅ Draw control added successfully');
            } catch (addControlError) {
                this.error('Failed to add MapboxDraw control to map:', addControlError);
                this.core.draw = null;
                return;
            }

        } catch (drawError) {
            this.error('Failed to initialize MapboxDraw:', drawError);
            this.core.draw = null;
        }
    }

    async getMapboxTokenWithRetry() {
        try {
            const tokenResponse = await fetch('/api/mapbox-token');

            if (!tokenResponse.ok) {
                throw new Error(`HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`);
            }

            const tokenData = await tokenResponse.json();

            if (!tokenData.success || !tokenData.token) {
                throw new Error(tokenData.error || 'No token in response');
            }

            return tokenData;
        } catch (error) {
            this.error('Failed to get Mapbox token:', error);
            throw error;
        }
    }

    setupMapControls() {
        try {
            this.core.map.addControl(new mapboxgl.ScaleControl({
                maxWidth: 100,
                unit: 'metric'
            }), 'bottom-left');

            this.core.map.addControl(new mapboxgl.NavigationControl({
                showCompass: true,
                showZoom: true,
                visualizePitch: true
            }), 'bottom-right');

            this.info('✅ Map controls added successfully');
        } catch (error) {
            this.error('Failed to add map controls:', error);
        }
    }

    async initializeManagers() {
        this.info('Initializing manager modules...');

        try {
            if (!this.core.map) {
                throw new Error('Map not initialized before managers');
            }

            await this.initializeDrawControl();

            this.info('Creating manager instances...');

            const managerInitResults = {};

            // Initialize SiteBoundaryCore (critical)
            try {
                let siteBoundaryCoreClass = null;
                let attempts = 0;
                const maxAttempts = 10;

                while (!siteBoundaryCoreClass && attempts < maxAttempts) {
                    if (typeof SiteBoundaryCore !== 'undefined') {
                        siteBoundaryCoreClass = SiteBoundaryCore;
                        break;
                    }
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (siteBoundaryCoreClass) {
                    this.core.siteBoundaryCore = new siteBoundaryCoreClass(this.core.map, this.core.draw);
                    await this.core.siteBoundaryCore.initialize();
                    managerInitResults.siteBoundary = 'success';
                    this.info('✅ SiteBoundaryCore initialized');
                } else {
                    throw new Error('SiteBoundaryCore class not available after waiting');
                }
            } catch (error) {
                this.error('Failed to initialize SiteBoundaryCore:', error);
                managerInitResults.siteBoundary = 'failed';
                this.createSiteBoundaryFallback();
            }

            // Initialize PropertySetbacksManager (critical)
            try {
                this.core.propertySetbacksManager = new PropertySetbacksManager(this.core.map);
                await this.core.propertySetbacksManager.initialize();
                managerInitResults.propertySetbacks = 'success';
                this.info('✅ PropertySetbacksManager initialized');
            } catch (error) {
                this.error('Failed to initialize PropertySetbacksManager:', error);
                managerInitResults.propertySetbacks = 'failed';
            }

            // Initialize FloorplanManager
            try {
                let floorplanManagerClass = null;
                let attempts = 0;
                const maxAttempts = 10;

                while (!floorplanManagerClass && attempts < maxAttempts) {
                    if (typeof FloorplanManager !== 'undefined') {
                        floorplanManagerClass = FloorplanManager;
                        break;
                    }
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (floorplanManagerClass) {
                    this.core.floorplanManager = new floorplanManagerClass(this.core.map);
                    await this.core.floorplanManager.initialize();
                    this.info('✅ FloorplanManager initialized');
                    managerInitResults.floorplan = 'success';
                } else {
                    this.warn('FloorplanManager class not available after waiting');
                    this.createFloorplanFallback();
                    managerInitResults.floorplan = 'fallback';
                }
            } catch (error) {
                this.error('Failed to initialize FloorplanManager:', error);
                managerInitResults.floorplan = 'failed';
                this.createFloorplanFallback();
            }

            // Initialize Map Features Manager
            try {
                if (typeof MapFeaturesManager === 'undefined') {
                    throw new Error('MapFeaturesManager class not found');
                }

                this.core.mapFeaturesManager = new MapFeaturesManager(this.core.map);
                await this.core.mapFeaturesManager.initialize();

                window.mapFeaturesManager = this.core.mapFeaturesManager;

                managerInitResults.mapFeatures = 'success';
                this.info('✅ MapFeaturesManager initialized');
            } catch (error) {
                this.error('Failed to initialize MapFeaturesManager:', error);
                managerInitResults.mapFeatures = 'failed';
                this.createMapFeaturesFallback();
            }

            // Initialize UIPanelManager (critical for UI)
            try {
                this.core.uiPanelManager = new UIPanelManager();
                await this.core.uiPanelManager.initialize();
                managerInitResults.uiPanel = 'success';
                this.info('✅ UIPanelManager initialized');
            } catch (error) {
                this.error('Failed to initialize UIPanelManager:', error);
                managerInitResults.uiPanel = 'failed';
            }

            // Initialize Extrusion3DManager
            try {
                if (typeof Extrusion3DManager !== 'undefined') {
                    this.core.extrusion3DManager = new Extrusion3DManager(this.core.map);
                    await this.core.extrusion3DManager.initialize();
                    managerInitResults.extrusion3D = 'success';
                    this.info('✅ Extrusion3DManager initialized');
                } else {
                    this.warn('Extrusion3DManager class not available - continuing without 3D features');
                    managerInitResults.extrusion3D = 'skipped';
                }
            } catch (error) {
                this.error('Failed to initialize Extrusion3DManager:', error);
                managerInitResults.extrusion3D = 'failed';
            }

            const criticalManagers = ['siteBoundary', 'propertySetbacks', 'uiPanel'];
            const failedCritical = criticalManagers.filter(manager => managerInitResults[manager] === 'failed');

            if (failedCritical.length > 0) {
                this.warn(`Some critical managers failed to initialize: ${failedCritical.join(', ')}`);
            }

            this.info('Manager initialization completed with results:', managerInitResults);

        } catch (error) {
            this.error('Failed to initialize managers:', error);
            throw error;
        }
    }

    createSiteBoundaryFallback() {
        const self = this;
        this.core.siteBoundaryCore = {
            initialize: () => Promise.resolve(),
            hasSiteBoundary: () => false,
            getSitePolygon: () => null,
            getPolygonEdges: () => [],
            isDrawingActive: () => false,
            calculateBuildableArea: () => Promise.reject(new Error('Not available')),
            previewBuildableArea: () => Promise.resolve(),
            getSiteData: () => ({}),
            toggleDrawingMode: () => {
                self.warn('SiteBoundaryCore not available - drawing disabled');
                alert('Site boundary drawing is currently unavailable. Please refresh the page.');
            },
            startDrawingMode: function() { this.toggleDrawingMode(); },
            stopDrawingMode: () => {},
            clearBoundary: () => {}
        };
    }

    createFloorplanFallback() {
        this.info('Creating FloorplanManager fallback');

        const floorplanCard = document.querySelector('.inspector-card[data-card="floorplan"]');
        if (floorplanCard) {
            floorplanCard.style.display = 'none';
        }

        this.core.floorplanManager = {
            initialize: () => Promise.resolve(),
            cleanup: () => {},
            isDrawing: false,
            stopDrawing: () => {},
            removeFloorplanFromMap: () => {},
            hasStructures: () => false,
            getStructures: () => [],
            getCurrentFloorplanCoordinates: () => null,
            toggleDrawingMode: () => {
                alert('Structure drawing is currently unavailable. Please refresh the page.');
            },
            startDrawing: function() { this.toggleDrawingMode(); },
            stopDrawing: () => {},
            clearStructure: () => {}
        };
    }

    createMapFeaturesFallback() {
        this.info('Creating comprehensive map features fallback');

        window.mapFeaturesManager = {
            isMeasuring: false,
            measurePoints: [],
            measurePopups: [],

            initialize: () => {
                this.setupFallbackEventListeners();
                return Promise.resolve();
            },

            toggleDimensions: () => {
                this.info('Fallback dimensions toggle called');

                const dimensionLayers = [
                    'boundary-dimension-labels', 'site-dimension-labels', 'site-dimensions',
                    'buildable-area-dimension-labels', 'buildable-dimension-labels', 'buildable-dimensions',
                    'setback-dimension-labels', 'setback-dimensions',
                    'structure-dimension-labels', 'structure-dimensions',
                    'footprint-dimension-labels', 'footprint-dimensions',
                    'building-dimension-labels', 'building-dimensions',
                    'floorplan-dimension-labels', 'floorplan-dimensions',
                    'measure-dimension-labels', 'measure-dimensions',
                    'polygon-dimensions', 'polygon-dimension-labels'
                ];

                const dimensionsBtn = document.querySelector('.dimensions-toggle-btn');
                const dimensionsToggle = document.querySelector('.dimensions-toggle-switch input');

                let isCurrentlyVisible = false;
                if (dimensionsToggle) {
                    isCurrentlyVisible = dimensionsToggle.checked;
                } else {
                    for (const layerId of dimensionLayers) {
                        if (this.core.map.getLayer(layerId)) {
                            const visibility = this.core.map.getLayoutProperty(layerId, 'visibility');
                            if (visibility !== 'none') {
                                isCurrentlyVisible = true;
                                break;
                            }
                        }
                    }
                }

                const newVisibility = isCurrentlyVisible ? 'none' : 'visible';
                const newToggleState = !isCurrentlyVisible;

                let layersUpdated = 0;
                dimensionLayers.forEach(layerId => {
                    if (this.core.map.getLayer(layerId)) {
                        this.core.map.setLayoutProperty(layerId, 'visibility', newVisibility);
                        layersUpdated++;
                    }
                });

                if (dimensionsBtn) {
                    if (newToggleState) {
                        dimensionsBtn.classList.add('active');
                    } else {
                        dimensionsBtn.classList.remove('active');
                    }
                }

                if (dimensionsToggle) {
                    dimensionsToggle.checked = newToggleState;
                }

                if (this.core.map) {
                    this.core.map.triggerRepaint();
                }

                this.info(`Fallback dimensions toggled: ${layersUpdated} layers set to ${newVisibility}`);
            },

            toggle3DBuildings: () => {
                this.info('Fallback 3D buildings toggle called');

                const buildingsBtn = document.getElementById('buildingsToggle');
                const buildingsControl = document.getElementById('buildingsControl');

                if (!buildingsBtn || !buildingsControl) {
                    this.warn('3D Buildings elements not found');
                    return;
                }

                const has3DLayer = this.core.map.getLayer('3d-buildings');

                if (has3DLayer) {
                    this.core.map.removeLayer('3d-buildings');
                    buildingsBtn.classList.remove('active');
                    buildingsBtn.textContent = '3D Buildings';
                    buildingsControl.classList.remove('expanded');
                    this.info('3D Buildings disabled (fallback)');
                } else {
                    try {
                        this.core.map.addLayer({
                            'id': '3d-buildings',
                            'source': 'composite',
                            'source-layer': 'building',
                            'type': 'fill-extrusion',
                            'minzoom': 8,
                            'paint': {
                                'fill-extrusion-color': '#9a9a9a',
                                'fill-extrusion-height': 15,
                                'fill-extrusion-base': 0,
                                'fill-extrusion-opacity': 0.8
                            }
                        });
                        buildingsBtn.classList.add('active');
                        buildingsControl.classList.add('expanded');
                        this.info('3D Buildings enabled (fallback)');
                    } catch (error) {
                        this.error('Failed to add 3D buildings (fallback):', error);
                    }
                }
            },

            toggleMeasureTool: () => {
                this.info('Fallback measure tool toggle called');

                const button = document.getElementById('measureToolButton');
                if (!button) return;

                if (window.mapFeaturesManager.isMeasuring) {
                    window.mapFeaturesManager.stopMeasuring();
                    button.classList.remove('active');
                    button.innerHTML = '📐';
                } else {
                    window.mapFeaturesManager.startMeasuring();
                    button.classList.add('active');
                    button.innerHTML = '✖';
                }
            },

            startMeasuring: () => {
                window.mapFeaturesManager.isMeasuring = true;
                this.core.map.getCanvas().style.cursor = 'crosshair';
                this.info('Measurement tool started (fallback)');
            },

            stopMeasuring: () => {
                window.mapFeaturesManager.isMeasuring = false;
                this.core.map.getCanvas().style.cursor = '';
                this.info('Measurement tool stopped (fallback)');
            },

            isMeasuringActive: () => {
                return window.mapFeaturesManager.isMeasuring;
            },

            changeMapStyle: (styleValue) => {
                this.info('Fallback map style change:', styleValue);
                if (this.core.map) {
                    let fullStyleUrl = styleValue;
                    if (!styleValue.startsWith('mapbox://')) {
                        fullStyleUrl = `mapbox://styles/mapbox/${styleValue}`;
                    }
                    this.core.map.setStyle(fullStyleUrl);
                }
            }
        };

        this.setupFallbackEventListeners();
    }

    setupFallbackEventListeners() {
        this.info('Setting up fallback event listeners for map controls');

        const styleSelector = document.getElementById('styleSelector');
        if (styleSelector) {
            styleSelector.addEventListener('change', (e) => {
                window.mapFeaturesManager.changeMapStyle(e.target.value);
            });
        }

        const measureBtn = document.getElementById('measureToolButton');
        if (measureBtn) {
            measureBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.mapFeaturesManager.toggleMeasureTool();
            });
        }

        const buildingsBtn = document.getElementById('buildingsToggle');
        if (buildingsBtn) {
            buildingsBtn.addEventListener('click', () => {
                window.mapFeaturesManager.toggle3DBuildings();
            });
        }

        const dimensionsBtn = document.querySelector('.dimensions-toggle-btn');
        if (dimensionsBtn) {
            dimensionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.mapFeaturesManager.toggleDimensions();
            });
        }

        const dimensionsToggle = document.querySelector('.dimensions-toggle-switch input');
        if (dimensionsToggle) {
            dimensionsToggle.addEventListener('change', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.mapFeaturesManager.toggleDimensions();
            });
        }

        this.info('Fallback event listeners setup completed');
    }

    setup3DTerrain() {
        try {
            if (!this.core.map.isStyleLoaded()) {
                this.core.map.once('styledata', () => {
                    this.setup3DTerrain();
                });
                return;
            }

            setTimeout(() => {
                try {
                    let terrainSourceExists = false;
                    try {
                        terrainSourceExists = !!this.core.map.getSource('mapbox-dem');
                    } catch (sourceCheckError) {
                        this.warn('Error checking for existing terrain source:', sourceCheckError.message);
                    }

                    if (!terrainSourceExists) {
                        try {
                            this.core.map.addSource('mapbox-dem', {
                                'type': 'raster-dem',
                                'url': 'mapbox://mapbox.terrain-rgb',
                                'tileSize': 512,
                                'maxzoom': 14
                            });
                            this.info('Added mapbox-dem terrain source');
                        } catch (addSourceError) {
                            if (addSourceError.message && addSourceError.message.includes('already exists')) {
                                this.info('Terrain source already exists, skipping creation');
                            } else {
                                throw addSourceError;
                            }
                        }
                    }

                    try {
                        this.core.map.setTerrain({ 
                            'source': 'mapbox-dem', 
                            'exaggeration': 1.2 
                        });
                    } catch (terrainError) {
                        this.warn('Failed to set terrain:', terrainError.message);
                    }

                    try {
                        if (!this.core.map.getLayer('sky')) {
                            this.core.map.addLayer({
                                'id': 'sky',
                                'type': 'sky',
                                'paint': {
                                    'sky-type': 'atmosphere',
                                    'sky-atmosphere-sun': [0.0, 90.0],
                                    'sky-atmosphere-sun-intensity': 15
                                }
                            });
                            this.info('Added sky layer');
                        }
                    } catch (skyError) {
                        this.warn('Failed to add sky layer:', skyError.message);
                    }

                    try {
                        this.core.map.setFog({
                            'range': [1, 20],
                            'horizon-blend': 0.3,
                            'color': 'white',
                            'high-color': '#add8e6',
                            'space-color': '#d8f2ff',
                            'star-intensity': 0.0
                        });
                    } catch (fogError) {
                        this.warn('Failed to set fog:', fogError.message);
                    }

                    this.info('✅ 3D terrain features setup completed');
                } catch (terrainError) {
                    if (terrainError.message && (terrainError.message.includes('mapbox-gl-draw-cold') || terrainError.message.includes('already exists'))) {
                        this.warn('MapboxDraw source conflict detected - this is expected and can be ignored');
                    } else {
                        this.error('Failed to add 3D terrain features:', terrainError);
                    }
                }
            }, 5000);

        } catch (error) {
            this.error('Error setting up 3D terrain:', error);
        }
    }
}

window.SiteInspectorInitializer = SiteInspectorInitializer;
