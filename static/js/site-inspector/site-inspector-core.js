/**
 * Site Inspector Core
 * Main orchestrator for the modular site inspector system
 */

class SiteInspectorCore extends BaseManager {
    constructor() {
        super('SiteInspectorCore');

        this.map = null;
        this.draw = null;
        this.siteData = {};

        // Manager instances
        this.siteBoundaryCore = null;
        this.propertySetbacksManager = null;
        this.floorplanManager = null;
        this.mapFeaturesManager = null;
        this.uiPanelManager = null;
        this.extrusion3DManager = null;

        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.info('🚀 Starting Site Inspector initialization...');

            // Validate required dependencies first
            if (!this.validateDependencies()) {
                throw new Error('Required dependencies not available');
            }

            // Load site data from template
            this.loadSiteData();

            // Load project address FIRST before map initialization
            const addressLoaded = await this.loadProjectAddress();

            if (!addressLoaded) {
                this.warn('⚠️ Project address could not be loaded, proceeding with default location');
                // Set a default center for Auckland, New Zealand if no project address found
                if (!this.siteData.center) {
                    this.siteData.center = {
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
            this.setupEventHandlers();

            this.isInitialized = true;

            // Hide loading state
            const mapLoading = document.getElementById('mapLoading');
            if (mapLoading) {
                mapLoading.style.display = 'none';
            }

            this.info('✅ Site Inspector initialization completed successfully');

        } catch (error) {
            this.error('❌ Site Inspector initialization failed:', error);
            this.showMapError(error.message || 'Unknown initialization error');

            // Attempt recovery
            this.attemptRecovery();
        }
    }

    loadSiteData() {
        // Get site data from template
        if (typeof window.siteData !== 'undefined' && window.siteData) {
            this.siteData = window.siteData;
            this.info('Site data loaded from template');
        } else {
            this.siteData = {
                ready_for_new_polygon: true,
                area: 0,
                area_m2: 0,
                type: 'residential',
                coordinates: [],
                center: null
            };
        }
    }

    validateDependencies() {
        return typeof mapboxgl !== 'undefined';
    }

    async loadProjectAddress() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            let projectId = urlParams.get('project_id') || urlParams.get('project');

            // Clean up malformed project IDs (remove any extra query parameters)
            if (projectId && projectId.includes('?')) {
                projectId = projectId.split('?')[0];
                this.info('Cleaned malformed project ID from URL:', projectId);
            }

            // Also check session storage
            if (!projectId) {
                projectId = sessionStorage.getItem('project_id') || sessionStorage.getItem('current_project_id');
            }

            // Also check for current project data in session storage
            const currentProjectAddress = sessionStorage.getItem('current_project_address');
            const currentProjectId = sessionStorage.getItem('current_project_id');

            // If we have current project data in session, use it
            if (!projectId && currentProjectId) {
                projectId = currentProjectId;
                this.info('Using current project ID from session:', projectId);
            }

            // If we have the address already in session, use it directly
            if (currentProjectAddress && currentProjectAddress !== 'undefined' && currentProjectAddress.trim() !== '') {
                this.info('✅ Using current project address from session:', currentProjectAddress);
                this.siteData.project_address = currentProjectAddress;
                return await this.geocodeProjectAddress(currentProjectAddress);
            }

            // Validate and clean project ID
            if (!projectId || !/^\d+$/.test(String(projectId).trim())) {
                this.info('No valid project ID found');
                return false;
            }

            projectId = String(projectId).trim();
            this.info('Loading project address for project ID:', projectId);

            // Try to get project address directly first
            try {
                const response = await fetch(`/api/project-address?project_id=${projectId}`);

                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.site_address && data.site_address.trim() !== '') {
                        this.siteData.project_address = data.site_address;
                        this.info('✅ Project address loaded from API:', data.site_address);

                        // Store in session for future use
                        sessionStorage.setItem('current_project_address', data.site_address);
                        sessionStorage.setItem('current_project_id', projectId);

                        if (data.location && data.location.lat && data.location.lng) {
                            this.siteData.center = {
                                lat: parseFloat(data.location.lat),
                                lng: parseFloat(data.location.lng)
                            };
                            this.info('✅ Project coordinates available from API:', this.siteData.center);
                            return true;
                        } else {
                            // Geocode the address
                            this.info('🌍 Geocoding project address from API:', data.site_address);
                            return await this.geocodeProjectAddress(data.site_address);
                        }
                    } else {
                        this.warn('No valid site address in API response:', data);
                    }
                } else {
                    this.warn('Failed to fetch project address, status:', response.status);
                }
            } catch (error) {
                this.warn('Failed to fetch project address directly:', error.message);
            }

            // If project data is available in template, use it
            if (window.projectData && window.projectData.address && window.projectData.address.trim() !== '') {
                this.siteData.project_address = window.projectData.address;
                this.info('✅ Using project address from template:', window.projectData.address);

                // Store in session for future use
                sessionStorage.setItem('current_project_address', window.projectData.address);
                if (projectId) {
                    sessionStorage.setItem('current_project_id', projectId);
                }

                return await this.geocodeProjectAddress(window.projectData.address);
            }

            this.warn('No project address found from any source');
            return false;
        } catch (error) {
            this.error('Error loading project address:', error);
            return false;
        }
    }

    async geocodeProjectAddress(address) {
        try {
            this.info('🌍 Geocoding project address:', address);

            // Check geocode cache
            const geocodeCacheKey = `geocode_${btoa(address)}`;
            const cached = this.getFromCache(geocodeCacheKey);
            if (cached && cached.timestamp > Date.now() - 86400000) { // 24 hour cache for geocoding
                this.info('✅ Using cached geocoding result');
                this.siteData.center = cached.center;
                return true;
            }

            const response = await fetch('/api/geocode-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: address })
            });

            if (!response.ok) {
                this.warn(`Geocoding API returned ${response.status} ${response.statusText}`);
                return false;
            }

            const data = await response.json();

            if (data.success && data.location && data.location.lat && data.location.lng) {
                this.siteData.center = {
                    lat: parseFloat(data.location.lat),
                    lng: parseFloat(data.location.lng)
                };

                // Cache the geocoding result
                this.setCache(geocodeCacheKey, {
                    center: this.siteData.center,
                    timestamp: Date.now()
                });

                this.info('✅ Project address geocoded successfully:', this.siteData.center);
                return true;
            } else {
                this.warn('Geocoding failed - no valid coordinates returned:', data.error || 'Unknown error');
                return false;
            }
        } catch (error) {
            this.error('Error geocoding project address:', error);
            return false;
        }
    }

    fetchWithRetry(url, options = {}) {
        const {
            timeout = 10000,
            retries = 2,
            ...fetchOptions
        } = options;

        return new Promise((resolve, reject) => {
            let attempts = 0;

            const attemptFetch = () => {
                attempts++;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                fetch(url, { ...fetchOptions, signal: controller.signal })
                    .then(response => {
                        clearTimeout(timeoutId);
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        resolve(response);
                    })
                    .catch(error => {
                        clearTimeout(timeoutId);
                        if (attempts <= retries) {
                            this.warn(`Fetch attempt ${attempts} failed, retrying: ${error.message}`);
                            setTimeout(attemptFetch, 1000 * attempts);
                        } else {
                            this.error(`Fetch failed after ${retries} attempts: ${error.message}`);
                            reject(error);
                        }
                    });
            };

            attemptFetch();
        });
    }

    getFromCache(key) {
        try {
            const cached = localStorage.getItem(`siteInspector_${key}`);
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    }

    setCache(key, data) {
        try {
            localStorage.setItem(`siteInspector_${key}`, JSON.stringify(data));
        } catch (error) {
            this.warn('Failed to cache data:', error);
        }
    }

    async initializeMap() {
        this.info('Initializing Mapbox map...');

        try {
            // Check if map container exists
            const mapContainer = document.getElementById('inspectorMap');
            if (!mapContainer) {
                throw new Error('Map container element not found');
            }

            // Validate required dependencies with better error messages
            if (typeof mapboxgl === 'undefined') {
                throw new Error('MapboxGL library not loaded - check CDN connection');
            }

            // MapboxDraw is not critical for basic map functionality
            if (typeof MapboxDraw === 'undefined') {
                this.warn('MapboxDraw library not loaded - drawing features will be limited');
            }

            // Get Mapbox token with caching and retry logic
            let tokenData;
            try {
                tokenData = await this.getMapboxTokenWithRetry();
            } catch (tokenError) {
                this.error('Failed to get Mapbox token after retries:', tokenError);
                throw new Error('Unable to authenticate with Mapbox services');
            }

            mapboxgl.accessToken = tokenData.token;
            this.info('✅ Mapbox token set successfully');

            // Determine map center - use project coordinates if available
            let center = [174.7762, -41.2865]; // Default Wellington fallback (better for NZ projects)
            let zoom = 13; // Default zoom

            if (this.siteData.center && this.siteData.center.lat && this.siteData.center.lng) {
                center = [this.siteData.center.lng, this.siteData.center.lat];
                zoom = 17; // Higher zoom for specific locations
                this.info('✅ Using project location for map center:', center, 'for address:', this.siteData.project_address);
            } else {
                this.warn('⚠️ No project coordinates available, using Wellington fallback:', center);
                this.info('Will attempt to geocode project address after map loads...');
            }

            // Initialize map with timeout and better error handling
            this.map = new mapboxgl.Map({
                container: 'inspectorMap',
                style: 'mapbox://styles/mapbox/outdoors-v12',
                center: center,
                zoom: zoom,
                pitch: 0,
                bearing: 0,
                attributionControl: false, // Disable to reduce clutter
                logoPosition: 'bottom-left',
                maxZoom: 22,
                minZoom: 8
            });

            // Wait for map to load with simple timeout
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Map loading timeout'));
                }, 15000);

                this.map.on('load', async () => {
                    clearTimeout(timeout);
                    this.setupMapControls();
                    this.setup3DTerrain();
                    this.info('Map loaded successfully');

                    // If we don't have coordinates yet, try to geocode the project address
                    if (!this.siteData.center && this.siteData.project_address) {
                        this.info('📍 Attempting to geocode project address after map load:', this.siteData.project_address);
                        const geocoded = await this.geocodeProjectAddress(this.siteData.project_address);
                        if (geocoded && this.siteData.center) {
                            this.map.flyTo({
                                center: [this.siteData.center.lng, this.siteData.center.lat],
                                zoom: 17,
                                essential: true
                            });
                            this.info('✅ Map recentered to project location after geocoding');
                        }
                    }

                    // Load property boundaries if we have a center location
                    if (this.siteData.center) {
                        await this.loadPropertyBoundaries(this.siteData.center.lat, this.siteData.center.lng);
                    }

                    resolve();
                });

                this.map.on('error', (e) => {
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
            this.draw = null;
            return;
        }

        try {
            // Wait for map to be fully loaded before initializing draw
            if (!this.map.isStyleLoaded()) {
                this.info('Waiting for map style to load before initializing draw...');
                return new Promise((resolve) => {
                    this.map.once('styledata', async () => {
                        try {
                            await this.initializeDrawControl();
                            resolve();
                        } catch (error) {
                            this.error('Error in deferred draw initialization:', error);
                            resolve(); // Still resolve to prevent hanging
                        }
                    });
                });
            }

            const config = window.SiteInspectorConfig;

            // Create MapboxDraw with comprehensive error handling
            try {
                this.draw = new MapboxDraw({
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
                this.draw = null;
                return;
            }

            // Add Draw control to map with comprehensive error handling
            this.info('Adding Draw control to map...');

            try {
                // Wait a moment for any remaining map operations to complete
                await new Promise(resolve => setTimeout(resolve, 100));

                // Check if map is still valid before adding control
                if (!this.map || !this.map.getContainer()) {
                    throw new Error('Map is no longer valid');
                }

                this.map.addControl(this.draw);

                // Wait for draw control to be fully initialized
                await new Promise(resolve => setTimeout(resolve, 200));

                this.info('✅ Draw control added successfully');
            } catch (addControlError) {
                this.error('Failed to add MapboxDraw control to map:', addControlError);
                this.draw = null;
                return;
            }

        } catch (drawError) {
            this.error('Failed to initialize MapboxDraw:', drawError);
            this.draw = null;
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
            // Add scale control at bottom-left
            this.map.addControl(new mapboxgl.ScaleControl({
                maxWidth: 100,
                unit: 'metric'
            }), 'bottom-left');

            // Add navigation controls at bottom-right, 120px from bottom to avoid ADAM chat widget
            this.map.addControl(new mapboxgl.NavigationControl({
                showCompass: true,
                showZoom: true,
                visualizePitch: true
            }), 'bottom-right');

            this.info('✅ Map controls added successfully');
        } catch (error) {
            this.error('Failed to add map controls:', error);
            // Don't throw - basic map still works
        }
    }

    async initializeManagers() {
        this.info('Initializing manager modules...');

        try {
            // Validate map is ready
            if (!this.map) {
                throw new Error('Map not initialized before managers');
            }

            // Initialize MapboxGL Draw with better error handling
            await this.initializeDrawControl();

            // Initialize managers with better error handling and fallbacks
            this.info('Creating manager instances...');

            const managerInitResults = {};

            // Initialize SiteBoundaryCore (critical)
            try {
                // Wait for SiteBoundaryCore to be available
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
                    this.siteBoundaryCore = new siteBoundaryCoreClass(this.map, this.draw);
                    await this.siteBoundaryCore.initialize();
                    managerInitResults.siteBoundary = 'success';
                    this.info('✅ SiteBoundaryCore initialized');
                } else {
                    throw new Error('SiteBoundaryCore class not available after waiting');
                }
            } catch (error) {
                this.error('Failed to initialize SiteBoundaryCore:', error);
                managerInitResults.siteBoundary = 'failed';

                // Create a minimal fallback with drawing functionality
                const self = this;
                this.siteBoundaryCore = {
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

            // Initialize PropertySetbacksManager (critical)
            try {
                this.propertySetbacksManager = new PropertySetbacksManager(this.map);
                await this.propertySetbacksManager.initialize();
                managerInitResults.propertySetbacks = 'success';
                this.info('✅ PropertySetbacksManager initialized');
            } catch (error) {
                this.error('Failed to initialize PropertySetbacksManager:', error);
                managerInitResults.propertySetbacks = 'failed';
            }

            // Initialize FloorplanManager
            try {
                // Wait a bit for the script to load if needed
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
                    this.floorplanManager = new floorplanManagerClass(this.map);
                    await this.floorplanManager.initialize();
                    this.info('✅ FloorplanManager initialized');
                    managerInitResults.floorplan = 'success';
                } else {
                    this.warn('FloorplanManager class not available after waiting');
                    // Create a minimal fallback with drawing functionality
                    const self = this;
                    this.floorplanManager = {
                        initialize: () => Promise.resolve(),
                        cleanup: () => {},
                        isDrawing: false,
                        stopDrawing: () => {},
                        removeFloorplanFromMap: () => {},
                        hasStructures: () => false,
                        getStructures: () => [],
                        getCurrentFloorplanCoordinates: () => null,
                        toggleDrawingMode: () => {
                            self.warn('FloorplanManager not available - drawing disabled');
                            alert('Structure drawing is currently unavailable. Please refresh the page.');
                        },
                        startDrawing: function() { this.toggleDrawingMode(); },
                        stopDrawing: () => {},
                        clearStructure: () => {}
                    };
                    managerInitResults.floorplan = 'fallback';
                }
            } catch (error) {
                this.error('Failed to initialize FloorplanManager:', error);
                managerInitResults.floorplan = 'failed';

                // Create error fallback
                this.floorplanManager = {
                    initialize: () => Promise.resolve(),
                    cleanup: () => {},
                    isDrawing: false,
                    stopDrawing: () => {},
                    removeFloorplanFromMap: () => {},
                    hasStructures: () => false,
                    getStructures: () => [],
                    getCurrentFloorplanCoordinates: () => null,
                    toggleDrawingMode: () => {
                        alert('Structure drawing failed to initialize. Error: ' + error.message);
                    },
                    startDrawing: function() { this.toggleDrawingMode(); },
                    stopDrawing: () => {},
                    clearStructure: () => {}
                };
            }

            // Initialize Map Features Manager
            try {
                // Ensure MapFeaturesManager class is available
                if (typeof MapFeaturesManager === 'undefined') {
                    throw new Error('MapFeaturesManager class not found');
                }

                this.mapFeaturesManager = new MapFeaturesManager(this.map);
                await this.mapFeaturesManager.initialize();

                // Make mapFeaturesManager globally accessible
                window.mapFeaturesManager = this.mapFeaturesManager;

                managerInitResults.mapFeatures = 'success';
                this.info('✅ MapFeaturesManager initialized');
            } catch (error) {
                this.error('Failed to initialize MapFeaturesManager:', error);
                managerInitResults.mapFeatures = 'failed';

                // Create a minimal fallback for map controls functionality
                this.createMapFeaturesFallback();
            }

            // Initialize UIPanelManager (critical for UI)
            try {
                this.uiPanelManager = new UIPanelManager();
                await this.uiPanelManager.initialize();
                managerInitResults.uiPanel = 'success';
                this.info('✅ UIPanelManager initialized');
            } catch (error) {
                this.error('Failed to initialize UIPanelManager:', error);
                managerInitResults.uiPanel = 'failed';
            }

            // Initialize Extrusion3DManager
            try {
                if (typeof Extrusion3DManager !== 'undefined') {
                    this.extrusion3DManager = new Extrusion3DManager(this.map);
                    await this.extrusion3DManager.initialize();
                    managerInitResults.extrusion3D = 'success';
                    this.info('✅ Extrusion3DManager initialized');
                } else {
                    this.warn('Extrusion3DManager class not available - continuing without 3D features');
                    managerInitResults.extrusion3D = 'skipped';
                }
            } catch (error) {
                this.error('Failed to initialize Extrusion3DManager:', error);
                managerInitResults.extrusion3D = 'failed';
                // Continue without 3D features
            }

            // Check if critical managers failed
            const criticalManagers = ['siteBoundary', 'propertySetbacks', 'uiPanel'];
            const failedCritical = criticalManagers.filter(manager => managerInitResults[manager] === 'failed');

            if (failedCritical.length > 0) {
                this.warn(`Some critical managers failed to initialize: ${failedCritical.join(', ')}`);
                // Continue anyway but with reduced functionality
            }

            this.info('Manager initialization completed with results:', managerInitResults);

        } catch (error) {
            this.error('Failed to initialize managers:', error);
            throw error;
        }
    }

    createFloorplanFallback() {
        this.info('Creating FloorplanManager fallback');

        // Hide floorplan-related UI elements
        const floorplanCard = document.querySelector('.inspector-card[data-card="floorplan"]');
        if (floorplanCard) {
            floorplanCard.style.display = 'none';
        }

        // Create minimal floorplan manager with essential methods
        this.floorplanManager = {
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

    setupEventHandlers() {
        this.info('Setting up inter-manager event handlers...');

        // Clear any existing event listeners to prevent duplicates
        if (window.eventBus && typeof window.eventBus.removeAllListeners === 'function') {
            window.eventBus.removeAllListeners();
        }

        // Handle setback calculations
        window.eventBus.on('recalculate-buildable-area', async (data) => {
            await this.handleBuildableAreaCalculation(data);
        });

        // Handle preview buildable area calculations
        window.eventBus.on('preview-buildable-area', async (data) => {
            await this.handleBuildableAreaPreview(data);
        });

        // Handle setback updates
        window.eventBus.on('setbacks-updated', (data) => {
            this.handleSetbacksUpdated(data);
        });

        // Handle site boundary changes
        window.eventBus.on('site-boundary-created', (data) => {
            this.handleSiteBoundaryCreated(data);
        });

        // Handle site boundary loaded
        window.eventBus.on('site-boundary-loaded', (data) => {
            this.handleSiteBoundaryLoaded(data);
        });

        // Handle tool conflicts
        window.eventBus.on('tool-activated', (toolName) => {
            this.handleToolActivated(toolName);
        });

        // Handle panel state changes
        window.eventBus.on('inspector-panel-toggled', (data) => {
            this.handlePanelToggled(data);
        });

        // Listen for comprehensive clearing event
        window.eventBus.on('clear-all-dependent-features', () => {
            this.info('Comprehensive clearing requested - clearing all dependent features');

            // Use a small delay to ensure the site boundary clearing is complete first
            setTimeout(() => {
                // Clear property setbacks data
                if (this.propertySetbacksManager) {
                    this.propertySetbacksManager.clearAllSetbackData();
                }

                // Clear floorplan data
                if (this.floorplanManager) {
                    this.floorplanManager.clearAllFloorplanData();
                }

                // Clear any 3D extrusions
                if (this.extrusion3DManager) {
                    this.extrusion3DManager.clearAllExtrusions();
                }

                // Hide all UI panels that depend on site boundary
                if (this.uiPanelManager) {
                    this.uiPanelManager.hideAllDependentPanels();
                }

                this.info('All dependent features cleared successfully');
            }, 50);
        });

        this.info('Event handlers setup completed');
    }

    async handleBuildableAreaPreview(data) {
        try {
            this.info('Handling buildable area preview with data:', data);

            // Use the unified core's preview method
            const result = await this.siteBoundaryCore.previewBuildableArea(data);

            // If the preview returns a result, display it
            if (result && result.buildable_coords) {
                this.updateBuildableAreaDisplay(result, true);
                this.info('Buildable area preview displayed on map');
            }
        } catch (error) {
            this.error('Error handling buildable area preview:', error);
        }
    }

    async handleBuildableAreaCalculation(data) {
        this.info('Handling buildable area calculation with data:', data);

        try {
            const result = await this.siteBoundaryCore.calculateBuildableArea(data);

            // Store result in property setbacks manager
            if (this.propertySetbacksManager) {
                this.propertySetbacksManager.currentBuildableArea = result;
                this.propertySetbacksManager.showExtrusionControls();
                this.propertySetbacksManager.keepInputsVisible();
            }

            if (this.uiPanelManager && this.uiPanelManager.showSuccess) {
                this.uiPanelManager.showSuccess('Buildable area calculated successfully');
            }

            // Emit success event
            window.eventBus.emit('setbacks-applied');

        } catch (error) {
            this.error('Buildable area calculation failed:', error);

            if (this.uiPanelManager && this.uiPanelManager.showError) {
                this.uiPanelManager.showError('Failed to calculate buildable area: ' + error.message);
            } else{
                alert('Failed to calculate buildable area: ' + error.message);
            }
        }
    }

    handleSetbacksUpdated(data) {
        this.info('Setbacks updated:', data);
        this.createSetbackVisualization(data);
    }

    createSetbackVisualization(data) {
        if (!data.selectedEdges || !data.selectedEdges.front || !data.selectedEdges.back) {
            return;
        }

        // Remove existing setback visualization
        this.clearSetbackVisualization();

        try {
            // Create line features
            const features = [];

            // Front setback line (green)
            if (frontEdge) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [frontEdge.start, frontEdge.end]
                    },
                    properties: {
                        type: 'front-setback',
                        setback: data.front
                    }
                });
            }

            // Back setback line (red)
            if (backEdge) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [backEdge.start, backEdge.end]
                    },
                    properties: {
                        type: 'back-setback',
                        setback: data.back
                    }
                });
            }

            // Add source and layers
            this.map.addSource('setback-lines', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features
                }
            });

            // Add front setback line layer
            this.map.addLayer({
                id: 'front-setback-line',
                type: 'line',
                source: 'setback-lines',
                filter: ['==', ['get', 'type'], 'front-setback'],
                paint: {
                    'line-color': '#28a745',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            // Add back setback line layer
            this.map.addLayer({
                id: 'back-setback-line',
                type: 'line',
                source: 'setback-lines',
                filter: ['==', ['get', 'type'], 'back-setback'],
                paint: {
                    'line-color': '#dc3545',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            this.info('Setback lines visualized on map');

        } catch (error) {
            this.error('Error creating setback visualization:', error);
        }
    }

    clearSetbackVisualization() {
        // Remove setback line layers
        const layersToRemove = ['front-setback-line', 'back-setback-line'];
        layersToRemove.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });

        // Remove setback line source
        if (this.map.getSource('setback-lines')) {
            this.map.removeSource('setback-lines');
        }

        this.info('Setback visualization cleared');
    }

    handleSiteBoundaryCreated(data) {
        this.info('Site boundary created, updating site data');

        // Update site data with complete structure
        this.siteData.coordinates = data.coordinates;
        this.siteData.area = data.area;
        this.siteData.area_m2 = data.area_m2 || data.area;
        this.siteData.center = data.center;
        this.siteData.center_lng = data.center_lng;
        this.siteData.center_lat = data.center_lat;
        this.siteData.type = data.type || 'residential';
        this.siteData.perimeter = data.perimeter;
        this.siteData.terrainBounds = data.terrainBounds;

        this.info('Site data updated with complete structure:', this.siteData);
    }

    handleSiteBoundaryLoaded(data) {
        this.info('Site boundary loaded, updating site data');

        // Update site data with complete structure from loaded boundary
        this.siteData.coordinates = data.coordinates;
        this.siteData.area = data.area;
        this.siteData.area_m2 = data.area_m2 || data.area;
        this.siteData.center = data.center;
        this.siteData.center_lng = data.center_lng;
        this.siteData.center_lat = data.center_lat;
        this.siteData.type = data.type || 'residential';
        this.siteData.perimeter = data.perimeter;
        this.siteData.terrainBounds = data.terrainBounds;

        this.info('Site data updated from loaded boundary:', this.siteData);

        // Emit boundary applied event to update UI flow
        window.eventBus.emit('boundary-applied');
    }

    handleToolActivated(toolName) {
        this.info('Tool activated:', toolName);

        // Stop conflicting tools
        if (toolName === 'floorplan' && this.mapFeaturesManager.isMeasuringActive()) {
            // Measuring tool will stop itself via event listener
        }

        if (toolName === 'measure' && this.floorplanManager) {
            // Stop floor plan drawing if active
            if (this.floorplanManager.stopDrawing) {
                this.floorplanManager.stopDrawing();
            }
        }
    }

    handlePanelToggled(data) {
        // Update any managers that need to know about panel state
        if (this.propertySetbacksManager && this.propertySetbacksManager.updateOverlayPosition) {
            this.propertySetbacksManager.updateOverlayPosition();
        }
    }

    updateBuildableAreaDisplay(result, isPreview = false) {
        try {
            // Remove existing buildable area layers efficiently
            const layersToRemove = ['buildable-area-fill', 'buildable-area-stroke'];
            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            if (this.map.getSource('buildable-area')) {
                this.map.removeSource('buildable-area');
            }

            if (result.buildable_coords && result.buildable_coords.length > 0) {
                // Convert coordinates to proper format [lng, lat] if needed
                let coordinates = result.buildable_coords;

                this.info(`Buildable area coordinates received: ${coordinates.length} points`, coordinates.slice(0, 2));

                // More robust coordinate format detection for buildable area
                if (coordinates[0] && coordinates[0].length === 2) {
                    const firstCoord = coordinates[0];
                    // Check if coordinates are in [lat, lng] format (latitude typically between -90 and 90)
                    // For New Zealand, longitude is around 165-180, latitude around -35 to -47
                    if (Math.abs(firstCoord[0]) <= 90 && Math.abs(firstCoord[1]) > 90) {
                        // Likely [lat, lng] format, flip to [lng, lat]
                        coordinates = coordinates.map(coord => [coord[1], coord[0]]);
                        this.info('Corrected buildable area coordinate format from [lat, lng] to [lng, lat]');
                        this.info('Converted coordinates sample:', coordinates.slice(0, 2));
                    }
                }

                // Ensure coordinates form a closed polygon
                const firstCoord = coordinates[0];
                const lastCoord = coordinates[coordinates.length - 1];
                if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                    coordinates.push([...firstCoord]);
                }

                const geojsonData = {
                    'type': 'geojson',
                    'data': {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [coordinates]
                        },
                        'properties': {
                            'area_m2': result.buildable_area_m2 || 0,
                            'type': 'buildable-area',
                            'is_preview': isPreview
                        }
                    }
                };

                this.info('Adding buildable area source with data:', geojsonData);
                this.map.addSource('buildable-area', geojsonData);

                // Different styling for preview vs confirmed with better visual feedback
                const fillColor = isPreview ? '#002040' : '#002040';
                const fillOpacity = isPreview ? 0.2 : 0.4;
                const strokeColor = isPreview ? '#002040' : '#002040';
                const strokeOpacity = isPreview ? 0.7 : 0.8;
                const strokeWidth = isPreview ? 2 : 3;

                // Add fill layer
                this.map.addLayer({
                    'id': 'buildable-area-fill',
                    'type': 'fill',
                    'source': 'buildable-area',
                    'layout': {},
                    'paint': {
                        'fill-color': fillColor,
                        'fill-opacity': fillOpacity
                    }
                });

                // Add stroke layer for better visibility
                this.map.addLayer({
                    'id': 'buildable-area-stroke',
                    'type': 'line',
                    'source': 'buildable-area',
                    'layout': {},
                    'paint': {
                        'line-color': strokeColor,
                        'line-width': strokeWidth,
                        'line-opacity': strokeOpacity
                    }
                });

                if (!isPreview) {
                    this.info(`Buildable area displayed on map with ${coordinates.length - 1} vertices`);
                }

                // Update legend to show buildable area
                this.updateBuildableAreaLegend(true);
            } else {
                if (!isPreview) {
                    this.warn('No buildable coordinates to display');
                }
                this.updateBuildableAreaLegend(false);
            }
        } catch (error) {
            this.error('Error updating buildable area display:', error);
        }
    }

    setup3DTerrain() {
        // Make 3D terrain optional and non-blocking
        try {
            // Ensure map is ready before adding sources
            if (!this.map.isStyleLoaded()) {
                this.map.once('styledata', () => {
                    this.setup3DTerrain();
                });
                return;
            }

            // Add terrain source with timeout - wait longer to avoid conflicts
            setTimeout(() => {
                try {
                    // Comprehensive check for existing terrain source
                    let terrainSourceExists = false;
                    try {
                        terrainSourceExists = !!this.map.getSource('mapbox-dem');
                    } catch (sourceCheckError) {
                        this.warn('Error checking for existing terrain source:', sourceCheckError.message);
                    }

                    if (!terrainSourceExists) {
                        try {
                            this.map.addSource('mapbox-dem', {
                                'type': 'raster-dem',
                                'url': 'mapbox://mapbox.terrain-rgb',
                                'tileSize': 512,
                                'maxzoom': 14
                            });
                            this.info('Added mapbox-dem terrain source');
                        } catch (addSourceError) {
                            if (addSourceError.message && (
                                addSourceError.message.includes('already exists') ||
                                addSourceError.message.includes('mapbox-gl-draw-cold') ||
                                addSourceError.message.includes('There is already a source')
                            )) {
                                this.info('Source conflict detected (likely from MapboxDraw), skipping terrain source creation');
                            } else {
                                throw addSourceError;
                            }
                        }
                    }

                    // Add terrain layer with moderate exaggeration
                    try {
                        this.map.setTerrain({ 
                            'source': 'mapbox-dem', 
                            'exaggeration': 1.2 
                        });
                    } catch (terrainError) {
                        this.warn('Failed to set terrain:', terrainError.message);
                    }

                    // Add sky layer with improved settings
                    try {
                        if (!this.map.getLayer('sky')) {
                            this.map.addLayer({
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

                    // Add fog for better 3D effect
                    try {
                        this.map.setFog({
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
                    // Check if it's the known source conflict error
                    if (terrainError.message && (
                        terrainError.message.includes('mapbox-gl-draw-cold') || 
                        terrainError.message.includes('already exists') ||
                        terrainError.message.includes('There is already a source')
                    )) {
                        this.warn('MapboxDraw source conflict detected - this is expected and can be ignored:', terrainError.message);
                    } else {
                        this.error('Failed to add 3D terrain features:', terrainError);
                    }
                    // Don't throw - basic map still works
                }
            }, 5000); // Even longer delay to ensure all map components are fully initialized

        } catch (error) {
            this.error('Error setting up 3D terrain:', error);
            // Don't throw - basic map still works
        }
    }

    showMapError(message) {
        this.error('Map error:', message);

        const mapLoading = document.getElementById('mapLoading');
        const mapError = document.getElementById('mapError');
        const errorDetails = document.getElementById('errorDetails');

        if (mapLoading) mapLoading.style.display = 'none';
        if (mapError) mapError.style.display = 'flex';
        if (errorDetails) errorDetails.textContent = message;
    }

    // Structure extrusion methods
    extrudeSelectedStructures() {
        try {
            const floorplanManager = this.getManager('floorplan');
            const propertySetbacksManager = this.getManager('propertySetbacks');

            if (!floorplanManager || !floorplanManager.state.geojsonPolygon) {
                this.showError('No structures available to extrude');
                return;
            }

            // Get height from property setbacks card
            const heightLimit = parseFloat(document.getElementById('heightLimit')?.value) || 9;

            // Extrude the structure(s)
            floorplanManager.extrudeStructure(heightLimit);

            // Update UI
            this.uiPanelManager.handleStructureExtruded();

            this.info(`Structure(s) extruded to ${heightLimit}m height`);
        } catch (error) {
            this.error('Failed to extrude structures:', error);
            this.showError('Failed to extrude structures: ' + error.message);
        }
    }

    removeStructure3D() {
        try {
            const floorplanManager = this.getManager('floorplan');
            if (floorplanManager && floorplanManager.removeStructure3D) {
                floorplanManager.removeStructure3D();
                this.uiPanelManager.handleStructure3DRemoved();
                this.info('3D structures removed');
            }
        } catch (error) {
            this.error('Failed to remove 3D structures:', error);
            this.showError('Failed to remove 3D structures: ' + error.message);
        }
    }

    // Public methods for UI integration
    getSiteData() {
        const boundaryData = this.siteBoundaryCore.getSiteData();

        // Merge with existing site data, ensuring all required fields are present
        const siteData = {
            ...this.siteData,
            ...boundaryData
        };

        // Ensure required fields are present with defaults if missing
        if (!siteData.type) {
            siteData.type = 'residential';
        }

        if (!siteData.center && siteData.center_lng && siteData.center_lat) {
            siteData.center = {
                lng: siteData.center_lng,
                lat: siteData.center_lat
            };
        }

        if (!siteData.area_m2 && siteData.area) {
            siteData.area_m2 = siteData.area;
        }

        return siteData;
    }

    getMap() {
        return this.map;
    }

    getDraw() {
        return this.draw;
    }

    /**
     * Get manager instance by name
     * @param {string} managerName - Name of the manager
     * @returns {Object|null} Manager instance or null
     */
    getManager(managerName) {
        const managerMap = {
            'siteBoundary': this.siteBoundaryCore,
            'propertySetbacks': this.propertySetbacksManager,
            'floorplan': this.floorplanManager,
            'mapFeatures': this.mapFeaturesManager,
            'uiPanel': this.uiPanelManager,
            'extrusion3D': this.extrusion3DManager
        };

        return managerMap[managerName] || null;
    }

    /**
     * Create comprehensive map features fallback when MapFeaturesManager fails
     */
    createMapFeaturesFallback() {
        this.info('Creating comprehensive map features fallback');

        window.mapFeaturesManager = {
            // Measure tool state
            isMeasuring: false,
            measurePoints: [],
            measurePopups: [],

            // Initialize fallback event listeners
            initialize: () => {
                this.setupFallbackEventListeners();
                return Promise.resolve();
            },

            // Toggle dimensions functionality
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
                        if (this.map.getLayer(layerId)) {
                            const visibility = this.map.getLayoutProperty(layerId, 'visibility');
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
                    if (this.map.getLayer(layerId)) {
                        this.map.setLayoutProperty(layerId, 'visibility', newVisibility);
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

                if (this.map) {
                    this.map.triggerRepaint();
                }

                this.info(`Fallback dimensions toggled: ${layersUpdated} layers set to ${newVisibility}`);
            },

            // 3D Buildings toggle
            toggle3DBuildings: () => {
                this.info('Fallback 3D buildings toggle called');

                const buildingsBtn = document.getElementById('buildingsToggle');
                const buildingsControl = document.getElementById('buildingsControl');

                if (!buildingsBtn || !buildingsControl) {
                    this.warn('3D Buildings elements not found');
                    return;
                }

                const has3DLayer = this.map.getLayer('3d-buildings');
                const isExpanded = buildingsControl.classList.contains('expanded');

                if (has3DLayer) {
                    // Remove buildings
                    this.map.removeLayer('3d-buildings');
                    buildingsBtn.classList.remove('active');
                    buildingsBtn.textContent = '3D Buildings';
                    buildingsControl.classList.remove('expanded');
                    this.info('3D Buildings disabled (fallback)');
                } else {
                    // Add simple 3D buildings
                    try {
                        this.map.addLayer({
                            'id': '3d-buildings',
                            'source': 'composite',
                            'source-layer': 'building',
                            'type': 'fill-extrusion',
                            'minzoom': 8,
                            'paint': {
                                'fill-extrusion-color': '#999999',
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

            // Measure tool toggle
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
                this.map.getCanvas().style.cursor = 'crosshair';
                this.info('Measurement tool started (fallback)');
            },

            stopMeasuring: () => {
                window.mapFeaturesManager.isMeasuring = false;
                this.map.getCanvas().style.cursor = '';
                this.info('Measurement tool stopped (fallback)');
            },

            isMeasuringActive: () => {
                return window.mapFeaturesManager.isMeasuring;
            },

            // Style change
            changeMapStyle: (styleValue) => {
                this.info('Fallback map style change:', styleValue);
                if (this.map) {
                    let fullStyleUrl = styleValue;
                    if (!styleValue.startsWith('mapbox://')) {
                        fullStyleUrl = `mapbox://styles/mapbox/${styleValue}`;
                    }
                    this.map.setStyle(fullStyleUrl);
                }
            }
        };

        // Initialize the fallback
        this.setupFallbackEventListeners();
    }

    setupFallbackEventListeners() {
        this.info('Setting up fallback event listeners for map controls');

        // Style selector
        const styleSelector = document.getElementById('styleSelector');
        if (styleSelector) {
            styleSelector.addEventListener('change', (e) => {
                window.mapFeaturesManager.changeMapStyle(e.target.value);
            });
        }

        // Measure tool button
        const measureBtn = document.getElementById('measureToolButton');
        if (measureBtn) {
            measureBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.mapFeaturesManager.toggleMeasureTool();
            });
        }

        // 3D Buildings toggle
        const buildingsBtn = document.getElementById('buildingsToggle');
        if (buildingsBtn) {
            buildingsBtn.addEventListener('click', () => {
                window.mapFeaturesManager.toggle3DBuildings();
            });
        }

        // Dimensions toggle
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

    updateBuildableAreaLegend(show) {
        const legendContent = document.getElementById('legendContent');
        if (!legendContent) return;

        // Find or create buildable area legend item
        let buildableAreaItem = legendContent.querySelector('.legend-buildable-area-item');

        if (show) {
            if (!buildableAreaItem) {
                buildableAreaItem = document.createElement('div');
                buildableAreaItem.className = 'legend-item legend-buildable-area-item';
                buildableAreaItem.innerHTML = `
                    <div class="legend-color" style="background-color: #002040; opacity: 0.4;"></div>
                    <span class="legend-label">Buildable Area</span>
                `;
                legendContent.appendChild(buildableAreaItem);
            }
            buildableAreaItem.style.display = 'flex';
        } else if (buildableAreaItem) {
            buildableAreaItem.style.display = 'none';
        }
    }

    isReady() {
        return this.isInitialized;
    }

    getProjectIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        let projectId = urlParams.get('project_id') || urlParams.get('project');

        // Clean up any malformed project IDs that might have extra parameters
        if (projectId && projectId.includes('?')) {
            projectId = projectId.split('?')[0];
            this.info('Cleaned malformed project ID from URL:', projectId);
        }

        // Validate project ID format
        if (projectId) {
            projectId = String(projectId).trim();
            if (!/^\d+$/.test(projectId)) {
                this.warn('Invalid project ID format in URL:', projectId);
                return null;
            }
        }

        return projectId;
    }

    captureTerrainBounds() {
        // Capture current map view bounds for terrain analysis
        if (!this.map) {
            this.warn('Map not available for terrain bounds capture');
            return null;
        }

        try {
            const bounds = this.map.getBounds();
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();

            // Calculate approximate dimensions in degrees
            const width = bounds.getEast() - bounds.getWest();
            const height = bounds.getNorth() - bounds.getSouth();

            return {
                bounds: {
                    north: bounds.getNorth(),
                    south: bounds.getSouth(),
                    east: bounds.getEast(),
                    west: bounds.getWest()
                },
                center: [center.lng, center.lat],
                zoom: zoom,
                width: width,
                height: height,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.error('Error capturing terrain bounds:', error);
            return null;
        }
    }

    async saveBuildableAreaToProject(result, setbackData) {
        try {
            const projectId = this.getProjectIdFromUrl();

            if (!projectId) {
                this.warn('No project ID found, cannot save buildable area');
                return;
            }

            // Capture current map view for terrain analysis
            const terrainBounds = this.captureTerrainBounds();

            // Get site coordinates from the boundary manager for reconstruction
            let siteCoords = null;
            let siteArea = null;
            if (this.siteBoundaryCore && this.siteBoundaryCore.hasSiteBoundary()) {
                const sitePolygon = this.siteBoundaryCore.getSitePolygon();
                if (sitePolygon && sitePolygon.geometry && sitePolygon.geometry.coordinates) {
                    siteCoords = sitePolygon.geometry.coordinates[0];
                    siteArea = this.siteBoundaryCore.calculatePolygonArea(siteCoords);
                    this.info('Site coordinates captured for snapshot:', siteCoords.length, 'points');
                }
            }

            const snapshotData = {
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
                site_coords: siteCoords, // Include original site coordinates for boundary reconstruction
                site_area_calculated: siteArea, // Include calculated site area
                timestamp: new Date().toISOString()
            };

            const response = await fetch(`/api/project/${projectId}/snapshot`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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

        } catch (error) {
            this.error('Error saving buildable area:', error);
        }
    }

    async loadProjectData() {
        // Get project ID from URL parameter
        const projectId = this.getProjectIdFromUrl();
        this.info(`Project ID from URL: ${projectId || 'none'}`, '');

        if (projectId) {
            try {
                // Load project data from API
                const projectResponse = await window.apiClient.get(`/project/${projectId}`);
                if (projectResponse.success) {
                    const project = projectResponse.project;
                    this.info(`✅ Project loaded: ${project.name} at ${project.address}`, '');

                    // Try to geocode the project address
                    const geocodeResponse = await window.apiClient.post('/geocode-location', {
                        query: project.address
                    });

                    if (geocodeResponse.success && geocodeResponse.location) {
                        const coords = [geocodeResponse.location.lng, geocodeResponse.location.lat];
                        this.info(`✅ Project geocoded successfully to: ${coords}`, '');
                        this.map.flyTo({
                            center: coords,
                            zoom: 16,
                            essential: true
                        });
                        return;
                    }
                }
            } catch (error) {
                this.warn(`Failed to load project data: ${error.message}`, '');
            }
        }

        // Fallback: try session storage for backward compatibility
        const projectAddress = sessionStorage.getItem('project_site_address');
        const projectName = sessionStorage.getItem('project_name');

        if (projectAddress) {
            this.info(`Project address from session: ${projectAddress}`, '');

            try {
                const response = await window.apiClient.post('/geocode-location', {
                    query: projectAddress
                });

                if (response.success && response.location) {
                    const coords = [response.location.lng, response.location.lat];
                    this.info(`✅ Project geocoded successfully to: ${coords}`, '');
                    this.map.flyTo({
                        center: coords,
                        zoom: 16,
                        essential: true
                    });
                    return;
                }
            } catch (error) {
                this.warn(`Geocoding failed for project address: ${error.message}`, '');
            }
        }

        this.warn('⚠️ Project address could not be loaded, proceeding with default location', '');
    }

    handleBoundaryApplied() {
        this.info('Boundary applied - updating UI state');
        this.uiPanelManager?.updateBoundaryAppliedState();
    }

    handleComprehensiveClearing() {
        this.info('Comprehensive clearing requested - clearing all dependent features');

        try {
            // Clear 3D extrusions
            if (this.extrusion3DManager) {
                this.extrusion3DManager.removeAllExtrusions();
            }

            // Clear floorplan/structure data
            if (this.floorplanManager && this.floorplanManager.clearAllStructures) {
                this.floorplanManager.clearAllStructures();
            }

            // Clear any remaining map layers that depend on site boundary
            this.clearDependentMapLayers();

            // Reset UI panel states
            if (this.uiPanelManager) {
                this.uiPanelManager.resetAllPanelStates();
            }

            this.info('Comprehensive clearing completed');
        } catch (error) {
            this.error('Error during comprehensive clearing:', error);
        }
    }

    clearDependentMapLayers() {
        try {
            // Clear setback visualization first
            this.clearSetbackVisualization();

            // Clear other dependent layers
            const layersToRemove = [
                'setback-fill', 'setback-stroke', 'setback-visualization',
                'buildable-area-fill', 'buildable-area-stroke', 'buildable-area-dimension-labels',
                'structure-fill', 'structure-stroke', 'structure-dimension-labels'
            ];

            const sourcesToRemove = [
                'setback-visualization', 'buildable-area', 'buildable-area-dimensions',
                'structure-footprint', 'structure-dimensions'
            ];

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

            this.info('Dependent map layers cleared');
        } catch (error) {
            this.error('Error clearing dependent map layers:', error);
        }
    }
    showMapError(message) {
        const mapContainer = document.getElementById('inspectorMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div style="
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    height: 100%; 
                    background: #f5f5f5;
                    color: #666;
                    font-family: Arial, sans-serif;
                    flex-direction: column;
                    text-align: center;
                    padding: 20px;
                ">
                    <div style="font-size: 48px; margin-bottom: 16px;">🗺️</div>
                    <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Map Failed to Load</div>
                    <div style="font-size: 14px; max-width: 400px;">${message}</div>
                    <button onclick="location.reload()" style="
                        margin-top: 16px; 
                        padding: 8px 16px; 
                        background: #007cbf; 
                        color: white; 
                        border: none; 
                        border-radius: 4px; 
                        cursor: pointer;
                    ">Retry</button>
                </div>
            `;
        }
    }

    attemptRecovery() {
        this.warn('Attempting recovery...');

        // Try to reload the page after a short delay
        setTimeout(() => {
            if (!this.isInitialized) {
                this.warn('Recovery: Reloading page...');
                location.reload();
            }
        }, 3000);
    }

    destroy() {
        if (this.siteBoundaryCore && typeof this.siteBoundaryCore.destroy === 'function') {
            this.siteBoundaryCore.destroy();
        }

        if (this.propertySetbacksManager && typeof this.propertySetbacksManager.destroy === 'function') {
            this.propertySetbacksManager.destroy();
        }

        if (this.floorplanManager && typeof this.floorplanManager.destroy === 'function') {
            this.floorplanManager.destroy();
        }

        if (this.mapFeaturesManager && typeof this.mapFeaturesManager.destroy === 'function') {
            this.mapFeaturesManager.destroy();
        }

        if (this.uiPanelManager && typeof this.uiPanelManager.destroy === 'function') {
            this.uiPanelManager.destroy();
        }

        if (this.extrusion3DManager && typeof this.extrusion3DManager.destroy === 'function') {
            this.extrusion3DManager.destroy();
        }

        // Clean up map
        if (this.map) {
            this.map.remove();
            this.map = null;
        }

        super.destroy();
    }

    /**
     * Loads property boundaries from the API and displays them on the map.
     * @param {number} lat - Latitude of the project location.
     * @param {number} lng - Longitude of the project location.
     */
    async loadPropertyBoundaries(lat, lng) {
        try {
            this.info('Loading property boundaries for location:', lat, lng);

            const response = await fetch('/api/property-boundaries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: lat, lng: lng })
            });

            if (!response.ok) {
                this.warn('Property boundaries API returned error:', response.status);
                return;
            }

            const data = await response.json();

            if (data.success && data.properties && data.properties.length > 0) {
                this.info(`Loaded ${data.properties.length} property boundaries`);
                this.displayPropertyBoundaries(data.properties, data.containing_property);
            } else {
                this.info('No property boundaries found for this location');
            }

        } catch (error) {
            this.error('Error loading property boundaries:', error);
        }
    }

    displayPropertyBoundaries(properties, containingProperty) {
        try {
            // Create features for all property boundaries
            const features = properties.map((property, index) => {
                const isContaining = containingProperty && property.id === containingProperty.id;

                return {
                    type: 'Feature',
                    geometry: property.geometry,
                    properties: {
                        id: property.id,
                        type: isContaining ? 'containing-property' : 'nearby-property',
                        address: property.address || 'Unknown address',
                        area: property.area || 'Unknown area'
                    }
                };
            });

            // Add property boundaries source
            if (this.map.getSource('property-boundaries')) {
                this.map.getSource('property-boundaries').setData({
                    type: 'FeatureCollection',
                    features: features
                });
            } else {
                this.map.addSource('property-boundaries', {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: features
                    }
                });

                // Add fill layer for property boundaries
                this.map.addLayer({
                    id: 'property-boundaries-fill',
                    type: 'fill',
                    source: 'property-boundaries',
                    paint: {
                        'fill-color': [
                            'case',
                            ['==', ['get', 'type'], 'containing-property'],
                            '#ff9500', // Orange for containing property
                            '#87ceeb'  // Light blue for nearby properties
                        ],
                        'fill-opacity': [
                            'case',
                            ['==', ['get', 'type'], 'containing-property'],
                            0.3, // More visible for containing property
                            0.15 // More subtle for nearby properties
                        ]
                    }
                });

                // Add stroke layer for property boundaries
                this.map.addLayer({
                    id: 'property-boundaries-stroke',
                    type: 'line',
                    source: 'property-boundaries',
                    paint: {
                        'line-color': [
                            'case',
                            ['==', ['get', 'type'], 'containing-property'],
                            '#ff9500', // Orange for containing property
                            '#4682b4'  // Steel blue for nearby properties
                        ],
                        'line-width': [
                            'case',
                            ['==', ['get', 'type'], 'containing-property'],
                            3, // Thicker line for containing property
                            2
                        ],
                        'line-dasharray': [
                            'case',
                            ['==', ['get', 'type'], 'containing-property'],
                            [5, 5], // Dashed line for containing property
                            [1, 0]  // Solid line for nearby properties
                        ],
                        'line-opacity': 0.8
                    }
                });
            }

            this.info('Property boundaries displayed on map');

            // Show info about containing property if found
            if (containingProperty) {
                this.info('Project address is within property:', containingProperty.address || 'Unknown address');
            }

        } catch (error) {
            this.error('Error displaying property boundaries:', error);
        }
    }
}

// Global helper functions (for template compatibility)
window.toggleInspectorPanel = function() {
    if (window.siteInspectorCore && window.siteInspectorCore.uiPanelManager) {
        window.siteInspectorCore.uiPanelManager.toggleInspectorPanel();
    }
};

window.toggleSiteInfoExpanded = function() {
    if (window.siteInspectorCore && window.siteInspectorCore.uiPanelManager) {
        window.siteInspectorCore.uiPanelManager.toggleSiteInfoExpanded();
    }
};

window.toggle3DBuildings = function() {
    if (window.siteInspectorCore && window.siteInspectorCore.mapFeaturesManager) {
        window.siteInspectorCore.mapFeaturesManager.toggle3DBuildings();
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    console.log('[SiteInspectorCore] DOM loaded, initializing modular site inspector...');

    try {
        // Wait for core dependencies
        if (typeof BaseManager === 'undefined') {
            console.log('[SiteInspectorCore] Waiting for core dependencies...');
            await new Promise(resolve => {
                const checkDeps = () => {
                    if (typeof BaseManager !== 'undefined') {
                        resolve();
                    } else {
                        setTimeout(checkDeps, 100);
                    }
                };
                checkDeps();
            });
        }

        // Only create site inspector if it doesn't already exist
        if (!window.siteInspectorCore) {
            window.siteInspectorCore = new SiteInspectorCore();
            await window.siteInspectorCore.initialize();
        }

        console.log('[SiteInspectorCore] ✅ Modular site inspector initialized successfully');

    } catch (error) {
        console.error('[SiteInspectorCore] ❌ Initialization failed:', error);

        // Show user-friendly error message
        const mapContainer = document.getElementById('inspectorMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f8f9fa; color: #666; flex-direction: column; text-align: center; padding: 20px;">
                    <h3 style="margin-bottom: 10px;">Map Loading Error</h3>
                    <p style="margin-bottom: 15px;">Unable to initialize the map. Please refresh the page to try again.</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: #007cbf; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Refresh Page
                    </button>
                    <p style="margin-top: 15px; font-size: 12px; color: #999;">Error: ${error.message}</p>
                </div>
            `;
        }
    }
});

window.SiteInspectorCore = SiteInspectorCore;