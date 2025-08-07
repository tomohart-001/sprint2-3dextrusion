
class EarthworksPlatformManager {
    constructor(terrainViewer) {
        this.terrainViewer = terrainViewer;
        this.platformDefinition = null;
        this.logger = console;
        this.init();
    }

    init() {
        this.logger.log("[EarthworksPlatformManager] Initializing platform manager...");
        this.setupUI();
        this.bindEvents();
    }

    setupUI() {
        // Create platform definition controls
        const platformControls = document.getElementById('platform-definition-controls');
        if (!platformControls) {
            // Create controls if they don't exist
            const controlsHTML = `
                <div id="platform-definition-controls" class="platform-controls" style="display: none;">
                    <h4>Platform Definition</h4>
                    <div class="form-group">
                        <label for="platform-length">Length (m):</label>
                        <input type="number" id="platform-length" value="30" min="1" max="100" step="0.5">
                    </div>
                    <div class="form-group">
                        <label for="platform-width">Width (m):</label>
                        <input type="number" id="platform-width" value="15" min="1" max="100" step="0.5">
                    </div>
                    <div class="form-group">
                        <label for="platform-rotation">Rotation (°):</label>
                        <input type="number" id="platform-rotation" value="0" min="0" max="359" step="1">
                    </div>
                    <div class="form-actions">
                        <button id="define-platform-btn" class="btn btn-primary">Define Platform</button>
                        <button id="clear-platform-btn" class="btn btn-secondary" style="display: none;">Clear Platform</button>
                    </div>
                    <div id="platform-info" class="platform-info" style="display: none;"></div>
                </div>
            `;
            
            // Find a suitable container
            const earthworksPanel = document.querySelector('.earthworks-panel') || 
                                  document.querySelector('.terrain-controls') ||
                                  document.body;
            
            earthworksPanel.insertAdjacentHTML('beforeend', controlsHTML);
        }
    }

    bindEvents() {
        const definePlatformBtn = document.getElementById('define-platform-btn');
        const clearPlatformBtn = document.getElementById('clear-platform-btn');
        
        if (definePlatformBtn) {
            definePlatformBtn.addEventListener('click', () => this.definePlatform());
        }
        
        if (clearPlatformBtn) {
            clearPlatformBtn.addEventListener('click', () => this.clearPlatform());
        }

        // Update platform preview on input change
        const inputs = ['platform-length', 'platform-width', 'platform-rotation'];
        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', () => this.updatePreview());
            }
        });
    }

    showControls() {
        const controls = document.getElementById('platform-definition-controls');
        if (controls) {
            controls.style.display = 'block';
        }
    }

    hideControls() {
        const controls = document.getElementById('platform-definition-controls');
        if (controls) {
            controls.style.display = 'none';
        }
    }

    async definePlatform() {
        try {
            const length = parseFloat(document.getElementById('platform-length')?.value || 30);
            const width = parseFloat(document.getElementById('platform-width')?.value || 15);
            const rotation = parseFloat(document.getElementById('platform-rotation')?.value || 0);

            this.logger.log("[EarthworksPlatformManager] Defining platform:", { length, width, rotation });

            const response = await fetch('/api/define-platform', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    length: length,
                    width: width,
                    rotation: rotation
                })
            });

            const result = await response.json();

            if (result.success) {
                this.platformDefinition = result.platform;
                this.logger.log("[EarthworksPlatformManager] Platform defined successfully:", this.platformDefinition);
                
                // Update UI
                this.updatePlatformInfo();
                this.showClearButton();
                
                // Visualize platform if terrain viewer is available
                if (this.terrainViewer && this.terrainViewer.visualizePlatform) {
                    this.terrainViewer.visualizePlatform(this.platformDefinition.coordinates);
                }

                // Show success message
                this.showNotification(`Platform defined: ${length}m × ${width}m at ${rotation}°`, 'success');
                
            } else {
                throw new Error(result.error || 'Failed to define platform');
            }

        } catch (error) {
            this.logger.error("[EarthworksPlatformManager] Platform definition failed:", error);
            this.showNotification('Failed to define platform: ' + error.message, 'error');
        }
    }

    clearPlatform() {
        this.platformDefinition = null;
        
        // Clear visualization
        if (this.terrainViewer && this.terrainViewer.clearPlatform) {
            this.terrainViewer.clearPlatform();
        }
        
        // Update UI
        this.hidePlatformInfo();
        this.hideClearButton();
        
        this.logger.log("[EarthworksPlatformManager] Platform cleared");
        this.showNotification('Platform cleared', 'info');
    }

    updatePreview() {
        // Optional: Show live preview of platform dimensions
        const length = parseFloat(document.getElementById('platform-length')?.value || 30);
        const width = parseFloat(document.getElementById('platform-width')?.value || 15);
        const rotation = parseFloat(document.getElementById('platform-rotation')?.value || 0);
        
        const area = length * width;
        const preview = document.getElementById('platform-preview');
        if (preview) {
            preview.textContent = `Preview: ${length}m × ${width}m (${area}m²) at ${rotation}°`;
        }
    }

    updatePlatformInfo() {
        const infoDiv = document.getElementById('platform-info');
        if (infoDiv && this.platformDefinition) {
            const { length, width, rotation, area } = this.platformDefinition;
            infoDiv.innerHTML = `
                <div class="platform-summary">
                    <strong>Current Platform:</strong><br>
                    Dimensions: ${length}m × ${width}m<br>
                    Area: ${area}m²<br>
                    Rotation: ${rotation}°
                </div>
            `;
            infoDiv.style.display = 'block';
        }
    }

    hidePlatformInfo() {
        const infoDiv = document.getElementById('platform-info');
        if (infoDiv) {
            infoDiv.style.display = 'none';
        }
    }

    showClearButton() {
        const clearBtn = document.getElementById('clear-platform-btn');
        if (clearBtn) {
            clearBtn.style.display = 'inline-block';
        }
    }

    hideClearButton() {
        const clearBtn = document.getElementById('clear-platform-btn');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        // Create or update notification
        let notification = document.getElementById('platform-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'platform-notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }
        
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.display = 'block';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            if (notification) {
                notification.style.display = 'none';
            }
        }, 3000);
    }

    getPlatformDefinition() {
        return this.platformDefinition;
    }

    hasPlatform() {
        return this.platformDefinition !== null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EarthworksPlatformManager;
}
