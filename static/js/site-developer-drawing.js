/**
 * Site Developer Drawing Module
 * Handles drawing tools, platform creation, and building layout functionality
 */
class SiteDeveloperDrawing {
    constructor(coreInstance) {
        this.core = coreInstance;
        this.buildPlatform = null;
        this.platformDimensions = { length: 20, width: 15, height: 0 };
        this.buildingUnits = [];
        this.isDraggingPlatform = false;
        this.isRotatingPlatform = false;
        this.platformControls = null;
        this.drawingMode = null;
        this.drawnObjects = [];
    }

    initialize() {
        console.log('[SiteDeveloperDrawing] Initializing drawing manager...');
        // Drawing overlay will be set up after terrain visualization is complete
    }

    setupDrawingOverlay() {
        console.log('[SiteDeveloperDrawing] Setting up drawing overlay functionality');

        // Create drawing controls panel
        const drawingPanel = document.createElement('div');
        drawingPanel.id = 'drawingPanel';
        drawingPanel.style.position = 'absolute';
        drawingPanel.style.top = '20px';
        drawingPanel.style.left = '20px';
        drawingPanel.style.background = 'rgba(0, 0, 0, 0.8)';
        drawingPanel.style.padding = '15px';
        drawingPanel.style.borderRadius = '8px';
        drawingPanel.style.color = 'white';
        drawingPanel.style.zIndex = '1000';
        drawingPanel.style.minWidth = '200px';

        drawingPanel.innerHTML = `
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Development Tools</h3>

            <!-- Platform Controls -->
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px;">
                <h4 style="margin: 0 0 8px 0; font-size: 12px;">Build Platform</h4>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 10px; width: 35px;">Length:</label>
                        <input type="number" id="platformLength" value="20" min="5" max="100" style="width: 50px; padding: 2px; font-size: 10px;">
                        <span style="font-size: 10px;">m</span>
                    </div>
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 10px; width: 35px;">Width:</label>
                        <input type="number" id="platformWidth" value="15" min="5" max="100" style="width: 50px; padding: 2px; font-size: 10px;">
                        <span style="font-size: 10px;">m</span>
                    </div>
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 10px; width: 35px;">Height:</label>
                        <input type="number" id="platformHeight" min="-5" max="5" step="0.1" value="0" style="width: 50px; padding: 2px; font-size: 10px;">
                        <span style="font-size: 10px;">m</span>
                    </div>
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 10px; width: 35px;">Rotate:</label>
                        <input type="range" id="platformRotation" min="0" max="360" step="1" value="0" style="flex: 1;">
                        <span id="rotationValue" style="font-size: 10px; width: 30px;">0°</span>
                    </div>
                    <button id="createPlatformBtn" class="drawing-tool-btn" style="font-size: 10px; padding: 4px 8px;">Create Platform</button>
                </div>
            </div>

            <!-- Building Layout Controls -->
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px;">
                <h4 style="margin: 0 0 8px 0; font-size: 12px;">AI Building Layout</h4>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <textarea id="buildingPrompt" placeholder="Describe your building layout (e.g., '3 townhouses in a row')" 
                             style="width: 100%; height: 60px; padding: 5px; font-size: 10px; border-radius: 3px; border: 1px solid #ccc; resize: vertical;"></textarea>
                    <button id="generateLayoutBtn" class="drawing-tool-btn" style="font-size: 10px; padding: 4px 8px;">Generate Layout</button>
                    <button id="clearLayoutBtn" class="drawing-tool-btn" style="background: #dc3545; font-size: 10px; padding: 4px 8px;">Clear Layout</button>
                </div>
            </div>

            <!-- Traditional Drawing Tools -->
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="drawBuildingBtn" class="drawing-tool-btn">Add Building</button>
                <button id="drawPathBtn" class="drawing-tool-btn">Add Path</button>
                <button id="drawVegetationBtn" class="drawing-tool-btn">Add Vegetation</button>
                <button id="drawUtilityBtn" class="drawing-tool-btn">Add Utility</button>
                <button id="clearDrawingBtn" class="drawing-tool-btn" style="background: #dc3545;">Clear All</button>
            </div>
        `;

        // Add CSS for drawing tool buttons
        const style = document.createElement('style');
        style.textContent = `
            .drawing-tool-btn {
                background: #007cbf;
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: background 0.2s;
            }
            .drawing-tool-btn:hover {
                background: #0056b3;
            }
            .drawing-tool-btn.active {
                background: #28a745;
            }
        `;
        document.head.appendChild(style);

        const plotContainer = document.getElementById('plotContainer');
        if (plotContainer) {
            plotContainer.appendChild(drawingPanel);

            // Setup drawing tool event listeners
            this.setupDrawingTools();
        }
    }

    setupDrawingTools() {
        console.log('[SiteDeveloperDrawing] Setting up drawing tools');

        // Platform control event listeners
        document.getElementById('createPlatformBtn')?.addEventListener('click', () => {
            this.createBuildPlatform();
        });

        document.getElementById('platformLength')?.addEventListener('input', (e) => {
            this.platformDimensions.length = parseFloat(e.target.value);
            this.updatePlatformDimensions();
        });

        document.getElementById('platformWidth')?.addEventListener('input', (e) => {
            this.platformDimensions.width = parseFloat(e.target.value);
            this.updatePlatformDimensions();
        });

        document.getElementById('platformHeight')?.addEventListener('input', (e) => {
            this.platformDimensions.height = parseFloat(e.target.value);
            this.updatePlatformHeight();
        });

        document.getElementById('platformRotation')?.addEventListener('input', (e) => {
            const rotation = parseFloat(e.target.value);
            document.getElementById('rotationValue').textContent = rotation + '°';
            this.rotatePlatform(rotation);
        });

        // Building layout control event listeners
        document.getElementById('generateLayoutBtn')?.addEventListener('click', () => {
            this.generateBuildingLayout();
        });

        document.getElementById('clearLayoutBtn')?.addEventListener('click', () => {
            this.clearBuildingLayout();
        });

        // Add event listeners to drawing buttons
        document.getElementById('drawBuildingBtn')?.addEventListener('click', () => {
            this.setDrawingMode('building');
        });

        document.getElementById('drawPathBtn')?.addEventListener('click', () => {
            this.setDrawingMode('path');
        });

        document.getElementById('drawVegetationBtn')?.addEventListener('click', () => {
            this.setDrawingMode('vegetation');
        });

        document.getElementById('drawUtilityBtn')?.addEventListener('click', () => {
            this.setDrawingMode('utility');
        });

        document.getElementById('clearDrawingBtn')?.addEventListener('click', () => {
            this.clearAllDrawings();
        });

        // Setup plot click handler for drawing
        const plotContainer = document.getElementById('plotContainer');
        if (plotContainer) {
            plotContainer.addEventListener('click', (event) => {
                if (this.drawingMode) {
                    this.handleDrawingClick(event);
                }
            });
        }
    }

    setDrawingMode(mode) {
        console.log('[SiteDeveloperDrawing] Setting drawing mode:', mode);

        // Clear active state from all buttons
        document.querySelectorAll('.drawing-tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Set drawing mode
        if (this.drawingMode === mode) {
            // Toggle off if clicking the same mode
            this.drawingMode = null;
        } else {
            this.drawingMode = mode;
            document.getElementById(`draw${mode.charAt(0).toUpperCase() + mode.slice(1)}Btn`)?.classList.add('active');
        }

        // Update cursor
        const plotContainer = document.getElementById('plotContainer');
        if (plotContainer) {
            plotContainer.style.cursor = this.drawingMode ? 'crosshair' : 'default';
        }
    }

    handleDrawingClick(event) {
        console.log('[SiteDeveloperDrawing] Handling drawing click for mode:', this.drawingMode);

        // This is a simplified implementation - in a full version you'd want to:
        // 1. Convert screen coordinates to 3D world coordinates
        // 2. Add the drawing object to the Plotly scene
        // 3. Store the object data for persistence

        const rect = event.target.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100; // Convert to terrain coordinates
        const y = ((event.clientY - rect.top) / rect.height) * 100;

        const drawingObject = {
            type: this.drawingMode,
            x: x,
            y: y,
            z: 0, // We'd calculate the terrain height here
            id: Date.now()
        };

        this.drawnObjects.push(drawingObject);
        this.addDrawingToPlot(drawingObject);

        console.log('[SiteDeveloperDrawing] Added drawing object:', drawingObject);
    }

    addDrawingToPlot(object) {
        // Add the drawing object as a new trace to the existing plot
        const colors = {
            building: '#ff6b35',
            path: '#ffd23f',
            vegetation: '#06ffa5',
            utility: '#b19cd9'
        };

        const newTrace = {
            x: [object.x],
            y: [object.y],
            z: [object.z + 1], // Slightly above terrain
            mode: 'markers',
            type: 'scatter3d',
            marker: {
                size: 8,
                color: colors[object.type] || '#ffffff',
                symbol: 'square'
            },
            name: `${object.type.charAt(0).toUpperCase() + object.type.slice(1)} ${object.id}`,
            showlegend: true
        };

        try {
            if (typeof Plotly !== 'undefined') {
                Plotly.addTraces('plotContainer', newTrace);
            }
        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error adding drawing to plot:', error);
        }
    }

    createBuildPlatform() {
        // Get rotation from stored dimensions first, then input field as fallback
        let rotation = this.platformDimensions.rotation;
        
        // If no stored rotation, check the input field
        if (rotation === undefined || rotation === null || isNaN(rotation)) {
            const rotationInput = document.getElementById('platformRotation');
            if (rotationInput) {
                rotation = parseFloat(rotationInput.value) || 0;
            } else {
                rotation = 0;
            }
        }
        
        // Always store the rotation value
        this.platformDimensions.rotation = rotation;
        
        console.log('[SiteDeveloperDrawing] Creating platform with rotation:', rotation, '°');
        this.createBuildPlatformWithRotation(rotation);
    }

    createBuildPlatformWithRotation(degrees) {
        console.log('[SiteDeveloperDrawing] Creating build platform with rotation:', degrees, '°');

        return new Promise((resolve, reject) => {
            try {
                // Remove existing platform first
                this.removeBuildPlatform();

                const length = this.platformDimensions.length;
                const width = this.platformDimensions.width;
                const height = this.platformDimensions.height;

                // Ensure rotation is stored in platform dimensions
                this.platformDimensions.rotation = degrees;

                // Get terrain data for platform positioning
                const maxX = this.core.terrainData?.width_m || 50;
                const maxY = this.core.terrainData?.length_m || 50;

                // Position platform at center of site
                const centerX = maxX / 2;
                const centerY = maxY / 2;

                // Create platform corners (before rotation)
                const baseCorners = [
                    [-length/2, -width/2],
                    [length/2, -width/2],
                    [length/2, width/2],
                    [-length/2, width/2],
                    [-length/2, -width/2] // Close the loop
                ];

                // Apply rotation - always use the degrees parameter passed to this function
                const rotation = degrees * Math.PI / 180; // Convert to radians
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);

                console.log('[SiteDeveloperDrawing] Applying rotation matrix:', {
                    degrees: degrees,
                    radians: rotation,
                    cos: cos,
                    sin: sin
                });

                const corners = baseCorners.map(([x, y]) => {
                    // Apply rotation matrix: [cos -sin; sin cos] * [x; y]
                    const rotatedX = x * cos - y * sin;
                    const rotatedY = x * sin + y * cos;
                    
                    // Translate to center position
                    const finalX = centerX + rotatedX;
                    const finalY = centerY + rotatedY;
                    
                    console.log(`[SiteDeveloperDrawing] Corner (${x}, ${y}) -> rotated (${rotatedX.toFixed(2)}, ${rotatedY.toFixed(2)}) -> final (${finalX.toFixed(2)}, ${finalY.toFixed(2)})`);
                    
                    return [finalX, finalY];
                });

                // Create platform trace
                const platformX = corners.map(c => c[0]);
                const platformY = corners.map(c => c[1]);
                const platformZ = corners.map(() => height);
                
                console.log('[SiteDeveloperDrawing] Platform trace coordinates:', {
                    x: platformX,
                    y: platformY,
                    z: platformZ,
                    rotation: degrees
                });

                this.buildPlatform = {
                    x: platformX,
                    y: platformY,
                    z: platformZ,
                    type: 'scatter3d',
                    mode: 'lines',
                    line: {
                        color: '#007cbf',
                        width: 6
                    },
                    name: `Build Platform (${length}m × ${width}m @ ${degrees}°)`,
                    showlegend: true,
                    opacity: 0.8,
                    meta: {
                        type: 'platform',
                        centerX: centerX,
                        centerY: centerY,
                        length: length,
                        width: width,
                        height: height,
                        rotation: degrees
                    }
                };

                // Add platform surface (filled) - exclude the closing corner for mesh3d
                const surfaceCorners = corners.slice(0, 4);
                const platformSurface = {
                    x: surfaceCorners.map(c => c[0]),
                    y: surfaceCorners.map(c => c[1]),
                    z: surfaceCorners.map(() => height),
                    type: 'mesh3d',
                    opacity: 0.3,
                    color: '#007cbf',
                    name: 'Platform Surface',
                    showlegend: false,
                    hovertemplate: `Platform Surface<br>Height: ${height}m<br>Rotation: ${degrees}°<extra></extra>`
                };

                if (typeof Plotly !== 'undefined') {
                    Plotly.addTraces('plotContainer', [this.buildPlatform, platformSurface])
                        .then(() => {
                            // Force a plot redraw to ensure rotation is visible
                            return Plotly.redraw('plotContainer');
                        })
                        .then(() => {
                            console.log(`[SiteDeveloperDrawing] Build platform created and rendered successfully with ${degrees}° rotation`);
                            resolve();
                        })
                        .catch(error => {
                            console.error('[SiteDeveloperDrawing] Error adding platform traces:', error);
                            reject(error);
                        });
                } else {
                    console.warn('[SiteDeveloperDrawing] Plotly not available');
                    resolve();
                }

            } catch (error) {
                console.error('[SiteDeveloperDrawing] Error creating build platform:', error);
                reject(error);
            }
        });
    }

    removeBuildPlatform() {
        try {
            if (typeof Plotly !== 'undefined') {
                const plotDiv = document.getElementById('plotContainer');
                if (plotDiv && plotDiv.data) {
                    // Find and remove platform traces
                    const tracesToRemove = [];
                    plotDiv.data.forEach((trace, index) => {
                        if (trace.name && (trace.name.includes('Build Platform') || trace.name === 'Platform Surface')) {
                            tracesToRemove.push(index);
                        }
                    });

                    if (tracesToRemove.length > 0) {
                        // Remove traces in reverse order to maintain correct indices
                        tracesToRemove.sort((a, b) => b - a);
                        tracesToRemove.forEach(index => {
                            Plotly.deleteTraces('plotContainer', index);
                        });
                        console.log('[SiteDeveloperDrawing] Removed', tracesToRemove.length, 'platform traces');
                    }
                }
            }
            this.buildPlatform = null;
        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error removing build platform:', error);
        }
    }

    updatePlatformDimensions() {
        if (this.buildPlatform) {
            const currentRotation = this.platformDimensions.rotation || 0;
            this.createBuildPlatformWithRotation(currentRotation);
        }
    }

    updatePlatformHeight() {
        if (this.buildPlatform) {
            const currentRotation = this.platformDimensions.rotation || 0;
            this.createBuildPlatformWithRotation(currentRotation);
        }
    }

    rotatePlatform(degrees) {
        try {
            console.log('[SiteDeveloperDrawing] Platform rotated to:', degrees, '°');

            // Update rotation in platform dimensions FIRST
            if (this.platformDimensions) {
                this.platformDimensions.rotation = degrees;
            }

            // Update the rotation input field to match
            const rotationInput = document.getElementById('platformRotation');
            const rotationValue = document.getElementById('rotationValue');
            if (rotationInput) rotationInput.value = degrees;
            if (rotationValue) rotationValue.textContent = degrees + '°';

            // Store current building layout before platform rotation
            const currentBuildingLayout = this.buildingLayout;

            // If platform exists, recreate it with new rotation
            if (this.buildPlatform) {
                // Store current dimensions
                const currentLength = this.platformDimensions.length;
                const currentWidth = this.platformDimensions.width;
                const currentHeight = this.platformDimensions.height;

                // Remove existing platform
                this.removeBuildPlatform();

                // Recreate with rotation and force redraw
                this.createBuildPlatformWithRotation(degrees).then(() => {
                    console.log('[SiteDeveloperDrawing] Platform rotation completed successfully:', degrees, '°');
                    
                    // If buildings exist, re-render them with the new platform rotation
                    if (currentBuildingLayout && this.buildingUnits && this.buildingUnits.length > 0) {
                        console.log('[SiteDeveloperDrawing] Re-rendering', this.buildingUnits.length, 'buildings with new platform rotation:', degrees, '°');
                        this.renderBuildingLayout(currentBuildingLayout);
                        
                        // Force a complete plot redraw to ensure visual changes
                        setTimeout(() => {
                            if (typeof Plotly !== 'undefined') {
                                Plotly.redraw('plotContainer').then(() => {
                                    console.log('[SiteDeveloperDrawing] Plot redraw completed for rotation:', degrees, '°');
                                });
                            }
                        }, 100);
                    }
                });
            } else {
                // If no platform but buildings exist, still re-render buildings
                if (currentBuildingLayout && this.buildingUnits && this.buildingUnits.length > 0) {
                    console.log('[SiteDeveloperDrawing] Re-rendering', this.buildingUnits.length, 'buildings with new platform rotation:', degrees, '°');
                    this.renderBuildingLayout(currentBuildingLayout);
                }
            }

        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error rotating platform:', error);
        }
    }

    displayBuildingLayout(layout) {
        try {
            console.log('[SiteDeveloperDrawing] Displaying building layout:', layout);

            if (!layout || !layout.units || !Array.isArray(layout.units)) {
                console.warn('[SiteDeveloperDrawing] Invalid layout data');
                return;
            }

            // Remove existing building traces
            this.removeBuildingLayout();

            const traces = [];
            const colors = ['#ff6b35', '#004e89', '#009639', '#fcab10', '#b08cc9'];

            layout.units.forEach((unit, index) => {
                const color = colors[index % colors.length];

                // Create building footprint (rectangle)
                const halfWidth = unit.width / 2;
                const halfLength = unit.length / 2;

                // Calculate corners based on rotation
                const rotation = (unit.rotation_deg || 0) * Math.PI / 180;
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);

                const corners = [
                    [unit.x + (-halfLength * cos - (-halfWidth) * sin), unit.y + (-halfLength * sin + (-halfWidth) * cos)],
                    [unit.x + (halfLength * cos - (-halfWidth) * sin), unit.y + (halfLength * sin + (-halfWidth) * cos)],
                    [unit.x + (halfLength * cos - halfWidth * sin), unit.y + (halfLength * sin + halfWidth * cos)],
                    [unit.x + (-halfLength * cos - halfWidth * sin), unit.y + (-halfLength * sin + halfWidth * cos)],
                    [unit.x + (-halfLength * cos - (-halfWidth) * sin), unit.y + (-halfLength * sin + (-halfWidth) * cos)] // Close the loop
                ];

                // Building outline
                const buildingTrace = {
                    x: corners.map(c => c[0]),
                    y: corners.map(c => c[1]),
                    z: corners.map(() => this.platformDimensions?.height || 0),
                    type: 'scatter3d',
                    mode: 'lines',
                    line: {
                        color: color,
                        width: 4
                    },
                    name: unit.id || `Building ${index + 1}`,
                    showlegend: true,
                    opacity: 0.8
                };

                // Building surface (filled)
                const buildingSurface = {
                    x: [corners[0][0], corners[1][0], corners[2][0], corners[3][0]],
                    y: [corners[0][1], corners[1][1], corners[2][1], corners[3][1]],
                    z: [(this.platformDimensions?.height || 0), (this.platformDimensions?.height || 0), 
                        (this.platformDimensions?.height || 0), (this.platformDimensions?.height || 0)],
                    type: 'mesh3d',
                    opacity: 0.3,
                    color: color,
                    name: `${unit.id || `Building ${index + 1}`} Surface`,
                    showlegend: false,
                    hovertemplate: `${unit.id || `Building ${index + 1}`}<br>Width: ${unit.width}m<br>Length: ${unit.length}m<extra></extra>`
                };

                traces.push(buildingTrace, buildingSurface);
            });

            // Add traces to plot
            if (typeof Plotly !== 'undefined' && traces.length > 0) {
                Plotly.addTraces('plotContainer', traces);
                console.log('[SiteDeveloperDrawing] Added', traces.length, 'building traces');
            }

            // Store building data
            this.buildingLayout = layout;

        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error displaying building layout:', error);
        }
    }

    removeBuildingLayout() {
        try {
            if (typeof Plotly !== 'undefined') {
                const plotDiv = document.getElementById('plotContainer');
                if (plotDiv && plotDiv.data) {
                    // Find and remove building traces
                    const tracesToRemove = [];
                    plotDiv.data.forEach((trace, index) => {
                        if (trace.name && (trace.name.includes('Building') || trace.name.includes('Unit_'))) {
                            tracesToRemove.push(index);
                        }
                    });

                    if (tracesToRemove.length > 0) {
                        Plotly.deleteTraces('plotContainer', tracesToRemove);
                        console.log('[SiteDeveloperDrawing] Removed', tracesToRemove.length, 'building traces');
                    }
                }
            }
            this.buildingLayout = null;
        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error removing building layout:', error);
        }
    }

    async generateBuildingLayout() {
        const prompt = document.getElementById('buildingPrompt')?.value?.trim();
        if (!prompt) {
            alert('Please enter a building layout description');
            return;
        }

        if (!this.buildPlatform) {
            alert('Please create a build platform first');
            return;
        }

        console.log('[SiteDeveloperDrawing] Generating building layout with prompt:', prompt);

        const generateBtn = document.getElementById('generateLayoutBtn');
        const originalText = generateBtn?.textContent || 'Generate Layout';
        const promptInput = document.getElementById('buildingPrompt');

        try {
            // Show loading state
            generateBtn.textContent = 'Generating...';
            generateBtn.disabled = true;

            // Send request to backend
            const response = await fetch('/api/generate-building-layout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: prompt,
                    platform_dimensions: this.platformDimensions,
                    platform_center: {
                        x: this.buildPlatform.meta.centerX,
                        y: this.buildPlatform.meta.centerY
                    },
                    site_data: this.core.siteData,
                    terrain_data: this.core.terrainData
                })
            });

            console.log('[SiteDeveloperDrawing] Fetch response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            console.log('[SiteDeveloperDrawing] Building layout result:', result);

            if (result.success) {
                console.log('[SiteDeveloperDrawing] Building layout generated:', result.layout);

                // Clear the input
                if (promptInput) promptInput.value = '';

                // Display the layout on the 3D visualization
                this.displayBuildingLayout(result.layout);

                alert(result.message || 'Building layout generated successfully!');
            } else {
                console.error('[SiteDeveloperDrawing] Building layout generation failed:', result.error);
                alert(`Failed to generate building layout: ${result.error}`);
            }

        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error generating building layout:', error);
            alert(`Error generating building layout: ${error.message}`);
        } finally {
            // Restore button state
            if (generateBtn) {
                generateBtn.textContent = originalText;
                generateBtn.disabled = false;
            }
        }
    }

    async generateBuildingLayoutFromChat(message, conversation) {
        try {
            // Set the prompt field if it exists
            const promptField = document.getElementById('buildingPrompt');
            if (promptField) {
                promptField.value = message;
            }

            const response = await fetch('/api/generate-building-layout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: message,
                    platform_dimensions: this.platformDimensions,
                    platform_center: {
                        x: this.buildPlatform?.meta?.centerX || 0,
                        y: this.buildPlatform?.meta?.centerY || 0
                    },
                    site_data: this.core.siteData,
                    terrain_data: this.core.terrainData
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                this.renderBuildingLayout(data.layout);

                const layout = data.layout;
                const responseMessage = `I've generated a layout with ${layout.total_units} ${layout.total_units === 1 ? 'unit' : 'units'} arranged in a ${layout.layout_type} pattern on your build platform. The buildings are positioned to fit within your ${this.platformDimensions.length}m × ${this.platformDimensions.width}m platform.\n\n**Layout Summary:**\n${layout.units.map(unit => `• ${unit.id}: ${unit.width.toFixed(1)}m × ${unit.length.toFixed(1)}m at position (${unit.x.toFixed(1)}, ${unit.y.toFixed(1)})`).join('\n')}\n\nYou can modify the layout by describing changes or create a new platform with different dimensions.`;

                if (this.core && this.core.addAssistantMessage) {
                    this.core.addAssistantMessage(responseMessage, conversation);
                }
            } else {
                throw new Error(data.error || 'Failed to generate building layout');
            }

        } catch (error) {
            console.error('Building layout generation failed:', error);
            throw error;
        }
    }

    renderBuildingLayout(layout) {
        console.log('[SiteDeveloperDrawing] Rendering building layout:', layout);

        // Clear existing building units
        this.clearBuildingLayout();

        if (!layout || !layout.units || layout.units.length === 0) {
            console.warn('[SiteDeveloperDrawing] No building units to render');
            return;
        }

        const platformHeight = this.platformDimensions.height;
        const platformRotation = this.platformDimensions.rotation || 0;
        
        // Get platform center for rotation calculations
        const platformCenterX = this.buildPlatform?.meta?.centerX || 0;
        const platformCenterY = this.buildPlatform?.meta?.centerY || 0;

        layout.units.forEach((unit, index) => {
            // Calculate unit's position relative to platform center, then apply platform rotation
            let unitX = unit.x;
            let unitY = unit.y;
            
            // If platform is rotated, rotate the unit's position around the platform center
            if (platformRotation !== 0) {
                const platformAngleRad = (platformRotation * Math.PI) / 180;
                const platformCos = Math.cos(platformAngleRad);
                const platformSin = Math.sin(platformAngleRad);
                
                // Calculate relative position from platform center
                const relativeX = unit.x - platformCenterX;
                const relativeY = unit.y - platformCenterY;
                
                // Rotate the relative position
                const rotatedRelativeX = relativeX * platformCos - relativeY * platformSin;
                const rotatedRelativeY = relativeX * platformSin + relativeY * platformCos;
                
                // Calculate new absolute position
                unitX = platformCenterX + rotatedRelativeX;
                unitY = platformCenterY + rotatedRelativeY;
                
                console.log(`[SiteDeveloperDrawing] Unit ${unit.id} rotated from (${unit.x.toFixed(1)}, ${unit.y.toFixed(1)}) to (${unitX.toFixed(1)}, ${unitY.toFixed(1)})`);
            }
            
            // Buildings also inherit the platform rotation for their orientation
            const totalRotation = platformRotation + (unit.rotation_deg || 0);
            
            // Create building footprint centered on the (possibly rotated) unit position
            const corners = [
                [unitX - unit.width/2, unitY - unit.length/2],
                [unitX + unit.width/2, unitY - unit.length/2],
                [unitX + unit.width/2, unitY + unit.length/2],
                [unitX - unit.width/2, unitY + unit.length/2],
                [unitX - unit.width/2, unitY - unit.length/2] // Close the loop
            ];

            // Apply building rotation around the building's center if there's any individual rotation
            if (unit.rotation_deg && unit.rotation_deg !== 0) {
                const buildingAngleRad = (unit.rotation_deg * Math.PI) / 180;
                const buildingCos = Math.cos(buildingAngleRad);
                const buildingSin = Math.sin(buildingAngleRad);

                corners.forEach(corner => {
                    // Rotate around building center (unitX, unitY)
                    const dx = corner[0] - unitX;
                    const dy = corner[1] - unitY;
                    corner[0] = unitX + (dx * buildingCos - dy * buildingSin);
                    corner[1] = unitY + (dx * buildingSin + dy * buildingCos);
                });
            }

            // Building footprint trace
            const buildingTrace = {
                x: corners.map(c => c[0]),
                y: corners.map(c => c[1]),
                z: corners.map(() => platformHeight + 0.1),
                type: 'scatter3d',
                mode: 'lines',
                line: {
                    color: '#ff6b35',
                    width: 4
                },
                name: `${unit.id} (${unit.width}×${unit.length}m)`,
                showlegend: true,
                opacity: 0.9,
                meta: {
                    type: 'building_unit',
                    unit_id: unit.id,
                    original_x: unit.x,
                    original_y: unit.y,
                    rotated_x: unitX,
                    rotated_y: unitY,
                    platform_rotation: platformRotation,
                    ...unit
                }
            };

            // Building surface (filled)
            const buildingSurface = {
                x: [corners[0][0], corners[1][0], corners[2][0], corners[3][0]],
                y: [corners[0][1], corners[1][1], corners[2][1], corners[3][1]],
                z: [platformHeight + 0.1, platformHeight + 0.1, platformHeight + 0.1, platformHeight + 0.1],
                type: 'mesh3d',
                opacity: 0.4,
                color: '#ff6b35',
                name: `${unit.id} Surface`,
                showlegend: false,
                hovertemplate: `${unit.id}<br>Size: ${unit.width}×${unit.length}m<br>Position: (${unitX.toFixed(1)}, ${unitY.toFixed(1)})<br>Platform Rotation: ${platformRotation}°<extra></extra>`
            };

            this.buildingUnits.push({
                footprint: buildingTrace,
                surface: buildingSurface,
                metadata: unit
            });

            try {
                if (typeof Plotly !== 'undefined') {
                    Plotly.addTraces('plotContainer', [buildingTrace, buildingSurface]);
                }
            } catch (error) {
                console.error('[SiteDeveloperDrawing] Error adding building unit to plot:', error);
            }
        });

        // Store the layout for potential re-rendering when platform rotates
        this.buildingLayout = layout;
        
        console.log('[SiteDeveloperDrawing] Building layout rendered successfully:', this.buildingUnits.length, 'units');
    }

    clearBuildingLayout() {
        try {
            if (typeof Plotly !== 'undefined') {
                const plotDiv = document.getElementById('plotContainer');
                if (plotDiv && plotDiv.data) {
                    // Find and remove building unit traces
                    const tracesToRemove = [];
                    plotDiv.data.forEach((trace, index) => {
                        if (trace.meta && trace.meta.type === 'building_unit') {
                            tracesToRemove.push(index);
                        }
                        if (trace.name && trace.name.includes('Surface') && 
                            this.buildingUnits.some(unit => trace.name.includes(unit.metadata.id))) {
                            tracesToRemove.push(index);
                        }
                    });

                    if (tracesToRemove.length > 0) {
                        // Remove in reverse order to maintain indices
                        tracesToRemove.sort((a, b) => b - a);
                        tracesToRemove.forEach(index => {
                            Plotly.deleteTraces('plotContainer', index);
                        });
                    }
                }
            }
            this.buildingUnits = [];
            this.buildingLayout = null; // Clear stored layout
            console.log('[SiteDeveloperDrawing] Building layout cleared');
        } catch (error) {
            console.error('[SiteDeveloperDrawing] Error clearing building layout:', error);
        }
    }

    clearAllDrawings() {
        console.log('[SiteDeveloperDrawing] Clearing all drawings');

        // Remove drawing traces from plot
        this.drawnObjects.forEach(obj => {
            try {
                if (typeof Plotly !== 'undefined') {
                    // Find and remove the trace (this is simplified - you'd want better trace management)
                    const plotDiv = document.getElementById('plotContainer');
                    if (plotDiv && plotDiv.data) {
                        const traceIndex = plotDiv.data.findIndex(trace => 
                            trace.name && trace.name.includes(obj.id.toString())
                        );
                        if (traceIndex > -1) {
                            Plotly.deleteTraces('plotContainer', traceIndex);
                        }
                    }
                }
            } catch (error) {
                console.error('[SiteDeveloperDrawing] Error removing trace:', error);
            }
        });

        // Clear drawing objects array
        this.drawnObjects = [];

        // Reset drawing mode
        this.setDrawingMode(null);
    }
}

// Make SiteDeveloperDrawing available globally
window.SiteDeveloperDrawing = SiteDeveloperDrawing;