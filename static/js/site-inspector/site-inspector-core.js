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

        // Import initialization and data modules
        this.initializer = new SiteInspectorInitializer(this);
        this.dataManager = new SiteInspectorDataManager(this);
    }

    async initialize() {
        try {
            this.info('🚀 Starting Site Inspector initialization...');
            return await this.initializer.initialize();
        } catch (error) {
            this.error('❌ Site Inspector initialization failed:', error);
            this.showMapError(error.message || 'Unknown initialization error');
            this.attemptRecovery();
        }
    }

    // Delegate data operations to data manager
    loadSiteData() {
        return this.dataManager.loadSiteData();
    }

    async loadProjectAddress() {
        return await this.dataManager.loadProjectAddress();
    }

    async geocodeProjectAddress(address) {
        return await this.dataManager.geocodeProjectAddress(address);
    }

    getSiteData() {
        return this.dataManager.getSiteData();
    }

    getProjectIdFromUrl() {
        return this.dataManager.getProjectIdFromUrl();
    }

    async saveBuildableAreaToProject(result, setbackData) {
        return await this.dataManager.saveBuildableAreaToProject(result, setbackData);
    }

    // Event handling methods
    setupEventHandlers() {
        this.info('Setting up inter-manager event handlers...');

        if (window.eventBus && typeof window.eventBus.removeAllListeners === 'function') {
            window.eventBus.removeAllListeners();
        }

        window.eventBus.on('recalculate-buildable-area', async (data) => {
            await this.handleBuildableAreaCalculation(data);
        });

        window.eventBus.on('preview-buildable-area', async (data) => {
            await this.handleBuildableAreaPreview(data);
        });

        window.eventBus.on('setbacks-updated', (data) => {
            this.handleSetbacksUpdated(data);
        });

        window.eventBus.on('site-boundary-created', (data) => {
            this.handleSiteBoundaryCreated(data);
        });

        window.eventBus.on('site-boundary-loaded', (data) => {
            this.handleSiteBoundaryLoaded(data);
        });

        window.eventBus.on('tool-activated', (toolName) => {
            this.handleToolActivated(toolName);
        });

        window.eventBus.on('inspector-panel-toggled', (data) => {
            this.handlePanelToggled(data);
        });

        window.eventBus.on('clear-all-dependent-features', () => {
            this.info('Comprehensive clearing requested - clearing all dependent features');

            setTimeout(() => {
                if (this.propertySetbacksManager) {
                    this.propertySetbacksManager.clearAllSetbackData();
                }

                if (this.floorplanManager) {
                    this.floorplanManager.clearAllFloorplanData();
                }

                if (this.extrusion3DManager) {
                    this.extrusion3DManager.clearAllExtrusions();
                }

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

            const result = await this.siteBoundaryCore.previewBuildableArea(data);

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

            if (this.propertySetbacksManager) {
                this.propertySetbacksManager.currentBuildableArea = result;
                this.propertySetbacksManager.showExtrusionControls();
                this.propertySetbacksManager.keepInputsVisible();
            }

            if (this.uiPanelManager && this.uiPanelManager.showSuccess) {
                this.uiPanelManager.showSuccess('Buildable area calculated successfully');
            }

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

    handleSiteBoundaryCreated(data) {
        this.info('Site boundary created, updating site data');
        this.dataManager.updateSiteData(data);
    }

    handleSiteBoundaryLoaded(data) {
        this.info('Site boundary loaded, updating site data');
        this.dataManager.updateSiteData(data);
        window.eventBus.emit('boundary-applied');
    }

    handleToolActivated(toolName) {
        this.info('Tool activated:', toolName);

        if (toolName === 'floorplan' && this.mapFeaturesManager.isMeasuringActive()) {
            // Measuring tool will stop itself via event listener
        }

        if (toolName === 'measure' && this.floorplanManager) {
            if (this.floorplanManager.stopDrawing) {
                this.floorplanManager.stopDrawing();
            }
        }
    }

    handlePanelToggled(data) {
        if (this.propertySetbacksManager && this.propertySetbacksManager.updateOverlayPosition) {
            this.propertySetbacksManager.updateOverlayPosition();
        }
    }

    // Visualization methods
    createSetbackVisualization(data) {
        if (!data.selectedEdges || !data.selectedEdges.front || !data.selectedEdges.back) {
            return;
        }

        this.clearSetbackVisualization();

        try {
            const frontEdge = data.selectedEdges.front;
            const backEdge = data.selectedEdges.back;
            const features = [];

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

            this.map.addSource('setback-lines', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features
                }
            });

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
        const layersToRemove = ['front-setback-line', 'back-setback-line'];
        layersToRemove.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });

        if (this.map.getSource('setback-lines')) {
            this.map.removeSource('setback-lines');
        }

        this.info('Setback visualization cleared');
    }

    updateBuildableAreaDisplay(result, isPreview = false) {
        try {
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
                let coordinates = result.buildable_coords;

                this.info(`Buildable area coordinates received: ${coordinates.length} points`, coordinates.slice(0, 2));

                if (coordinates[0] && coordinates[0].length === 2) {
                    const firstCoord = coordinates[0];
                    if (Math.abs(firstCoord[0]) <= 90 && Math.abs(firstCoord[1]) > 90) {
                        coordinates = coordinates.map(coord => [coord[1], coord[0]]);
                        this.info('Corrected buildable area coordinate format from [lat, lng] to [lng, lat]');
                        this.info('Converted coordinates sample:', coordinates.slice(0, 2));
                    }
                }

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

                const fillColor = isPreview ? '#002040' : '#002040';
                const fillOpacity = isPreview ? 0.2 : 0.4;
                const strokeColor = isPreview ? '#002040' : '#002040';
                const strokeOpacity = isPreview ? 0.7 : 0.8;
                const strokeWidth = isPreview ? 2 : 3;

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

    updateBuildableAreaLegend(show) {
        const legendContent = document.getElementById('legendContent');
        if (!legendContent) return;

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

    // Utility methods
    extrudeSelectedStructures() {
        try {
            const floorplanManager = this.getManager('floorplan');

            if (!floorplanManager || !floorplanManager.state.geojsonPolygon) {
                this.showError('No structures available to extrude');
                return;
            }

            const heightLimit = parseFloat(document.getElementById('heightLimit')?.value) || 9;
            floorplanManager.extrudeStructure(heightLimit);
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

    getMap() {
        return this.map;
    }

    getDraw() {
        return this.draw;
    }

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

    isReady() {
        return this.isInitialized;
    }

    clearDependentMapLayers() {
        try {
            this.clearSetbackVisualization();

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

        if (this.map) {
            this.map.remove();
            this.map = null;
        }

        super.destroy();
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

        if (!window.siteInspectorCore) {
            window.siteInspectorCore = new SiteInspectorCore();
            await window.siteInspectorCore.initialize();
        }

        console.log('[SiteInspectorCore] ✅ Modular site inspector initialized successfully');

    } catch (error) {
        console.error('[SiteInspectorCore] ❌ Initialization failed:', error);

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