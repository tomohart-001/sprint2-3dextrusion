
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
                if (this.core.propertySetbacksManager) {
                    this.core.propertySetbacksManager.clearAllSetbackData();
                }

                if (this.core.floorplanManager) {
                    this.core.floorplanManager.clearAllFloorplanData();
                }

                if (this.core.extrusion3DManager) {
                    this.core.extrusion3DManager.clearAllExtrusions();
                }

                if (this.core.uiPanelManager) {
                    this.core.uiPanelManager.hideAllDependentPanels();
                }

                this.info('All dependent features cleared successfully');
            }, 50);
        });

        this.info('Event handlers setup completed');
    }

    async handleBuildableAreaPreview(data) {
        try {
            this.info('Handling buildable area preview with data:', data);

            const result = await this.core.siteBoundaryCore.previewBuildableArea(data);

            if (result && result.buildable_coords) {
                this.core.visualizationManager.updateBuildableAreaDisplay(result, true);
                this.info('Buildable area preview displayed on map');
            }
        } catch (error) {
            this.error('Error handling buildable area preview:', error);
        }
    }

    async handleBuildableAreaCalculation(data) {
        this.info('Handling buildable area calculation with data:', data);

        try {
            const result = await this.core.siteBoundaryCore.calculateBuildableArea(data);

            if (this.core.propertySetbacksManager) {
                this.core.propertySetbacksManager.currentBuildableArea = result;
                this.core.propertySetbacksManager.showExtrusionControls();
                this.core.propertySetbacksManager.keepInputsVisible();
            }

            if (this.core.uiPanelManager && this.core.uiPanelManager.showSuccess) {
                this.core.uiPanelManager.showSuccess('Buildable area calculated successfully');
            }

            window.eventBus.emit('setbacks-applied');

        } catch (error) {
            this.error('Buildable area calculation failed:', error);

            if (this.core.uiPanelManager && this.core.uiPanelManager.showError) {
                this.core.uiPanelManager.showError('Failed to calculate buildable area: ' + error.message);
            } else{
                alert('Failed to calculate buildable area: ' + error.message);
            }
        }
    }

    handleSetbacksUpdated(data) {
        this.info('Setbacks updated:', data);
        this.core.visualizationManager.createSetbackVisualization(data);
    }

    handleSiteBoundaryCreated(data) {
        this.info('Site boundary created, updating site data');
        this.core.dataManager.updateSiteData(data);
    }

    handleSiteBoundaryLoaded(data) {
        this.info('Site boundary loaded, updating site data');
        this.core.dataManager.updateSiteData(data);
        window.eventBus.emit('boundary-applied');
    }

    handleToolActivated(toolName) {
        this.info('Tool activated:', toolName);

        if (toolName === 'floorplan' && this.core.mapFeaturesManager.isMeasuringActive()) {
            // Measuring tool will stop itself via event listener
        }

        if (toolName === 'measure' && this.core.floorplanManager) {
            if (this.core.floorplanManager.stopDrawing) {
                this.core.floorplanManager.stopDrawing();
            }
        }
    }

    handlePanelToggled(data) {
        if (this.core.propertySetbacksManager && this.core.propertySetbacksManager.updateOverlayPosition) {
            this.core.propertySetbacksManager.updateOverlayPosition();
        }
    }
}

window.SiteInspectorEventHandlers = SiteInspectorEventHandlers;
