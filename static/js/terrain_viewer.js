class TerrainViewer {
    constructor() {
        this.terrainCanvas = null; // Placeholder for the Plotly chart div
        this.earthworksManager = null;
        this.platformManager = null; // To hold the EarthworksPlatformManager instance
        this.plotInitialized = false;
    }

    // Initialize the terrain viewer, setting up the canvas and controls
    init() {
        console.log('[TerrainViewer] Initializing...');
        this.terrainCanvas = document.getElementById('terrain-plot');

        if (!this.terrainCanvas) {
            console.error('[TerrainViewer] Terrain plot canvas not found!');
            return;
        }

        // Initialize Plotly if not already done
        this.initPlotly();

        // Initialize earthworks feature
        this.initializeEarthworks();

        // Initialize platform manager
        this.initializePlatformManager();

        console.log('[TerrainViewer] Initialization complete.');
    }

    // Initialize Plotly for terrain visualization
    initPlotly() {
        if (!this.plotInitialized) {
            console.log('[TerrainViewer] Initializing Plotly...');
            // Basic plot setup - can be expanded with more options
            const layout = {
                title: '3D Terrain Model',
                scene: {
                    xaxis: { title: 'East (m)' },
                    yaxis: { title: 'North (m)' },
                    zaxis: { title: 'Elevation (m)' }
                },
                margin: { l: 0, r: 0, b: 0, t: 40 },
                hovermode: 'closest',
                showlegend: true,
                autosize: true
            };

            // Placeholder data for initial render or empty state
            const data = [{
                type: 'surface',
                x: [0], y: [0], z: [0],
                showscale: false,
                colorscale: 'Viridis'
            }];

            Plotly.newPlot('terrain-plot', data, layout, { responsive: true });
            this.plotInitialized = true;
            console.log('[TerrainViewer] Plotly initialized.');
        }
    }

    // Update the terrain visualization with new data
    updateTerrain(x, y, z) {
        if (!this.plotInitialized || !this.terrainCanvas) {
            console.warn('[TerrainViewer] Plot not initialized, cannot update terrain.');
            return;
        }

        console.log('[TerrainViewer] Updating terrain data...');

        const terrainTrace = {
            type: 'surface',
            x: x,
            y: y,
            z: z,
            showscale: true,
            colorscale: 'Viridis',
            hovertemplate: 'X: %{x:.1f}m<br>Y: %{y:.1f}m<br>Z: %{z:.2f}m<extra></extra>'
        };

        // Use Plotly.react for efficient updates
        Plotly.react(this.terrainCanvas, [terrainTrace], this.terrainCanvas.layout, { responsive: true });
        console.log('[TerrainViewer] Terrain data updated.');
    }

    // Method to calculate earthworks (implementation would be elsewhere)
    calculateEarthworks() {
        console.log('[TerrainViewer] Calculating earthworks...');
        // This would trigger the earthworks calculation logic
        // For now, just a placeholder
        alert('Earthworks calculation initiated! (See console)');
    }

    initializeEarthworks() {
        console.log('[TerrainViewer] Initializing earthworks feature...');

        // Add earthworks calculation button
        const earthworksBtn = document.getElementById('calculate-earthworks-btn');
        if (earthworksBtn) {
            earthworksBtn.addEventListener('click', () => this.calculateEarthworks());
        }
    }

    initializePlatformManager() {
        console.log('[TerrainViewer] Initializing platform manager...');

        // Load platform manager script dynamically
        if (typeof EarthworksPlatformManager === 'undefined') {
            const script = document.createElement('script');
            script.src = '/static/js/earthworks-platform-manager.js';
            script.onload = () => {
                this.platformManager = new EarthworksPlatformManager(this);
            };
            document.head.appendChild(script);
        } else {
            this.platformManager = new EarthworksPlatformManager(this);
        }

        // Add button to show platform controls
        this.addPlatformControlsButton();
    }

    addPlatformControlsButton() {
        const controlsContainer = document.querySelector('.terrain-controls') || 
                                 document.querySelector('.earthworks-panel');

        if (controlsContainer && !document.getElementById('show-platform-controls-btn')) {
            const showControlsBtn = document.createElement('button');
            showControlsBtn.id = 'show-platform-controls-btn';
            showControlsBtn.className = 'btn btn-secondary';
            showControlsBtn.textContent = 'Define Platform';
            showControlsBtn.addEventListener('click', () => {
                if (this.platformManager) {
                    this.platformManager.showControls();
                }
            });

            controlsContainer.appendChild(showControlsBtn);
        }
    }

    visualizePlatform(platformCoords) {
        console.log('[TerrainViewer] Visualizing platform with coordinates:', platformCoords);

        if (!this.terrainCanvas || !platformCoords || !Array.isArray(platformCoords)) {
            console.error('[TerrainViewer] Cannot visualize platform - missing canvas or coordinates');
            return;
        }

        // Convert coordinates for visualization
        const platformTrace = {
            x: platformCoords.map(coord => coord.x),
            y: platformCoords.map(coord => coord.y),
            z: platformCoords.map(() => 0.5), // Slightly above ground
            type: 'scatter3d',
            mode: 'lines',
            line: {
                color: 'red',
                width: 8
            },
            name: 'Defined Platform',
            hovertemplate: 'Platform Boundary<br>X: %{x:.1f}m<br>Y: %{y:.1f}m<extra></extra>'
        };

        // Close the platform polygon
        platformTrace.x.push(platformTrace.x[0]);
        platformTrace.y.push(platformTrace.y[0]);
        platformTrace.z.push(platformTrace.z[0]);

        // Add to existing plot
        if (window.Plotly && this.terrainCanvas) {
            Plotly.addTraces(this.terrainCanvas, [platformTrace]);
        }
    }

    clearPlatform() {
        console.log('[TerrainViewer] Clearing platform visualization');

        if (window.Plotly && this.terrainCanvas) {
            // Remove platform traces
            const currentData = this.terrainCanvas.data;
            const platformTraceIndices = [];

            currentData.forEach((trace, index) => {
                if (trace.name && trace.name.includes('Platform')) {
                    platformTraceIndices.push(index);
                }
            });

            if (platformTraceIndices.length > 0) {
                Plotly.deleteTraces(this.terrainCanvas, platformTraceIndices);
            }
        }
    }
}

// Example of how you might instantiate and use the TerrainViewer
// Ensure this script is included after the DOM is ready and Plotly.js is loaded.
document.addEventListener('DOMContentLoaded', () => {
    const viewer = new TerrainViewer();
    viewer.init();

    // Example: Simulate loading terrain data and updating the viewer
    // In a real application, this data would come from an API or user input.
    setTimeout(() => {
        const sampleX = [0, 10, 10, 0, 0];
        const sampleY = [0, 0, 10, 10, 0];
        const sampleZ = [0, 0, 0, 0, 0]; // Flat terrain for simplicity

        // To make it a bit more interesting, let's create a simple slope
        const dataPoints = 20;
        const xCoords = Array.from({ length: dataPoints }, (_, i) => i * 5);
        const yCoords = Array.from({ length: dataPoints }, (_, i) => i * 5);
        const zData = [];

        for (let i = 0; i < dataPoints; i++) {
            const row = [];
            for (let j = 0; j < dataPoints; j++) {
                row.push(Math.sin(xCoords[j] / 10) + Math.cos(yCoords[i] / 10) * 0.5 + (i + j) * 0.1);
            }
            zData.push(row);
        }

        viewer.updateTerrain(xCoords, yCoords, zData);
    }, 2000); // Simulate data loading delay
});