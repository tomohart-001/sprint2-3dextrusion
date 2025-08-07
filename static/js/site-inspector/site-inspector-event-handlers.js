/**
 * Site Inspector Event Handlers
 * Handles all inter-manager communication and event orchestration
 */

class SiteInspectorEventHandlers extends BaseManager {
    constructor(core) {
        super('SiteInspectorEventHandlers');
        this.core = core;
    }

    setupEventHandlers() {
        this.info('Setting up Site Inspector event handlers...');

        try {
            // Map click events
            if (this.core.map) {
                this.core.map.on('click', (e) => {
                    this.handleMapClick(e);
                });

                this.core.map.on('styledata', () => {
                    this.handleStyleChange();
                });
            }

            // Manager communication events
            this.setupManagerEvents();

            this.info('✅ Event handlers setup completed');
        } catch (error) {
            this.error('Failed to setup event handlers:', error);
        }
    }

    handleMapClick(e) {
        // Handle map click events and delegate to appropriate managers
        if (this.core.mapFeaturesManager && this.core.mapFeaturesManager.isMeasuringActive()) {
            this.core.mapFeaturesManager.handleMeasureClick(e);
        }
    }

    handleStyleChange() {
        this.info('Map style changed, refreshing layers...');

        // Refresh all manager layers after style change
        setTimeout(() => {
            if (this.core.siteBoundaryCore && this.core.siteBoundaryCore.refreshLayers) {
                this.core.siteBoundaryCore.refreshLayers();
            }

            if (this.core.propertySetbacksManager && this.core.propertySetbacksManager.refreshLayers) {
                this.core.propertySetbacksManager.refreshLayers();
            }

            if (this.core.floorplanManager && this.core.floorplanManager.refreshLayers) {
                this.core.floorplanManager.refreshLayers();
            }
        }, 1000);
    }

    setupManagerEvents() {
        // Setup inter-manager communication
        this.info('Setting up manager communication events');

        // Site boundary events
        if (this.core.siteBoundaryCore) {
            // Add site boundary event listeners
        }

        // Property setbacks events
        if (this.core.propertySetbacksManager) {
            // Add setbacks event listeners
        }

        // Floorplan events
        if (this.core.floorplanManager) {
            // Add floorplan event listeners
        }
    }
}

window.SiteInspectorEventHandlers = SiteInspectorEventHandlers;