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

        // Import modular components
        this.initializer = new SiteInspectorInitializer(this);
        this.dataManager = new SiteInspectorDataManager(this);
        this.eventHandlers = new SiteInspectorEventHandlers(this);
        this.visualizationManager = new SiteInspectorVisualizationManager(this);
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
        return this.eventHandlers.setupEventHandlers();
    }

    

    // Visualization methods (delegated to visualization manager)
    updateBuildableAreaDisplay(result, isPreview = false) {
        return this.visualizationManager.updateBuildableAreaDisplay(result, isPreview);
    }

    clearDependentMapLayers() {
        return this.visualizationManager.clearDependentMapLayers();
    }

    showMapError(message) {
        return this.visualizationManager.showMapError(message);
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