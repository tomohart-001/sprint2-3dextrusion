/**
 * Comments Manager
 * Handles comment placement, viewing, and management on the map
 */

class CommentsManager extends BaseManager {
    constructor(map) {
        super('CommentsManager');
        this.map = map;
        this.isCommenting = false;
        this.comments = [];
        this.commentPopups = [];
        this.projectId = null;
    }

    async initialize() {
        this.info('Initializing Comments Manager...');
        this.setupEventListeners();
        this.setupCommentsControl();
        this.loadProjectComments();
        this.info('Comments Manager initialized successfully');
    }

    setupEventListeners() {
        // Comments tool button
        const commentsBtn = document.getElementById('commentsToolButton');
        if (commentsBtn) {
            commentsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCommentsTool();
            });
        }

        // Listen for other tool activations to stop commenting
        if (window.eventBus) {
            window.eventBus.on('tool-activated', (toolName) => {
                if (toolName !== 'comments' && this.isCommenting) {
                    this.stopCommenting();
                }
            });
        }

        // Listen for project changes
        window.eventBus.on('project-changed', (data) => {
            this.projectId = data.projectId;
            this.loadProjectComments();
        });
    }

    setupCommentsControl() {
        this.info('Comments control ready');
    }

    toggleCommentsTool() {
        const button = document.getElementById('commentsToolButton');

        if (this.isCommenting) {
            this.stopCommenting();
            button.classList.remove('active');
            button.innerHTML = '💬';
        } else {
            this.startCommenting();
            button.classList.add('active');
            button.innerHTML = '✖';

            // Notify other tools
            window.eventBus.emit('tool-activated', 'comments');
        }
    }

    startCommenting() {
        this.isCommenting = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this.handleCommentClick);
        this.showExistingComments();
        this.addCommentToolExitListeners();
        this.info('Comments tool started - click on map to add comments');
    }

    stopCommenting() {
        this.isCommenting = false;

        // Remove event listeners safely
        if (this.handleCommentClick) {
            this.map.off('click', this.handleCommentClick);
        }

        // Reset cursor
        if (this.map.getCanvas()) {
            this.map.getCanvas().style.cursor = '';
        }

        this.hideComments();
        this.removeCommentToolExitListeners();

        const button = document.getElementById('commentsToolButton');
        if (button) {
            button.classList.remove('active');
            button.innerHTML = '💬';
        }

        this.info('Comments tool stopped');
    }

    handleCommentClick = (e) => {
        if (!this.isCommenting) return;

        // Check if the click was on a comment marker
        if (e.originalEvent && e.originalEvent.target &&
            e.originalEvent.target.closest('.comment-marker')) {
            return; // Don't create new comment if clicking on existing marker
        }

        e.preventDefault();
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
        }

        const point = [e.lngLat.lng, e.lngLat.lat];
        this.showCommentDialog(point);
    }

    showCommentDialog(coordinates) {
        const modal = document.createElement('div');
        modal.className = 'comment-modal';
        modal.innerHTML = `
            <div class="comment-modal-content">
                <div class="comment-modal-header">
                    <div class="comment-header-content">
                        <h3>💬 Add Comment</h3>
                        <p>Add a note or observation to this location</p>
                    </div>
                    <button class="comment-modal-close">×</button>
                </div>
                <div class="comment-modal-body">
                    <textarea
                        id="commentText"
                        placeholder="Enter your comment here..."
                        rows="4"
                        maxlength="500"
                    ></textarea>
                    <div class="comment-character-count">
                        <span id="commentCharCount">0</span>/500
                    </div>
                </div>
                <div class="comment-modal-footer">
                <button class="comment-btn-cancel">Cancel</button>
                <button class="comment-btn-save">Save Comment</button>
            </div>
            </div>
        `;

        // Add modal styles
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.2s ease-out;
        `;

        const content = modal.querySelector('.comment-modal-content');
        content.style.cssText = `
            background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 16px;
            padding: 0;
            width: 90%;
            max-width: 440px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            color: #1a1a1a;
            overflow: hidden;
            animation: slideIn 0.3s ease-out;
        `;

        // Add animations
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideIn {
                from { transform: translateY(-20px) scale(0.95); opacity: 0; }
                to { transform: translateY(0) scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);

        // Style header
        const header = modal.querySelector('.comment-modal-header');
        header.style.cssText = `
            background: linear-gradient(135deg, #4a6cf7 0%, #3a5ae0 100%);
            padding: 24px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        `;

        const headerContent = modal.querySelector('.comment-header-content');
        headerContent.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const title = modal.querySelector('h3');
        title.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: #ffffff;
            line-height: 1.2;
        `;

        const subtitle = modal.querySelector('p');
        subtitle.style.cssText = `
            margin: 0;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.8);
            font-weight: 400;
        `;

        const closeBtn = modal.querySelector('.comment-modal-close');
        closeBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: #ffffff;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            flex-shrink: 0;
        `;

        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
        });

        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        });

        // Style body
        const body = modal.querySelector('.comment-modal-body');
        body.style.cssText = `
            padding: 24px;
            background: rgba(248, 249, 250, 0.5);
        `;

        const textarea = modal.querySelector('#commentText');
        textarea.style.cssText = `
            width: 100%;
            min-height: 100px;
            padding: 14px 16px;
            background: #ffffff;
            border: 1px solid rgba(0, 0, 0, 0.2);
            border-radius: 10px;
            color: #1a1a1a;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.5;
            resize: vertical;
            transition: all 0.2s ease;
            box-sizing: border-box;
        `;

        textarea.style.setProperty('outline', 'none');

        textarea.addEventListener('focus', () => {
            textarea.style.borderColor = '#4a6cf7';
            textarea.style.background = '#ffffff';
            textarea.style.boxShadow = '0 0 0 3px rgba(74, 108, 247, 0.15)';
        });

        textarea.addEventListener('blur', () => {
            textarea.style.borderColor = 'rgba(0, 0, 0, 0.2)';
            textarea.style.background = '#ffffff';
            textarea.style.boxShadow = 'none';
        });

        const charCountContainer = modal.querySelector('.comment-character-count');
        charCountContainer.style.cssText = `
            text-align: right;
            margin-top: 8px;
            font-size: 12px;
            color: rgba(0, 0, 0, 0.6);
        `;

        const charCount = modal.querySelector('#commentCharCount');

        textarea.addEventListener('input', () => {
            const length = textarea.value.length;
            charCount.textContent = length;

            if (length > 450) {
                charCount.style.color = '#dc3545';
            } else if (length > 400) {
                charCount.style.color = '#ffc107';
            } else {
                charCount.style.color = 'rgba(0, 0, 0, 0.6)';
            }
        });

        // Style footer
        const footer = modal.querySelector('.comment-modal-footer');
        footer.style.cssText = `
            padding: 20px 24px 24px 24px;
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            background: rgba(248, 249, 250, 0.8);
            border-top: 1px solid rgba(0, 0, 0, 0.08);
        `;

        const cancelBtn = modal.querySelector('.comment-btn-cancel');
        cancelBtn.style.cssText = `
            padding: 10px 20px;
            background: #ffffff;
            border: 1px solid rgba(0, 0, 0, 0.2);
            color: #1a1a1a;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
            min-width: 80px;
        `;

        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = '#f8f9fa';
            cancelBtn.style.borderColor = 'rgba(0, 0, 0, 0.3)';
        });

        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = '#ffffff';
            cancelBtn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
        });

        const saveBtn = modal.querySelector('.comment-btn-save');
        saveBtn.style.cssText = `
            padding: 10px 20px;
            background: linear-gradient(135deg, #4a6cf7 0%, #3a5ae0 100%);
            border: none;
            color: #ffffff;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(74, 108, 247, 0.3);
            min-width: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        `;

        saveBtn.addEventListener('mouseenter', () => {
            saveBtn.style.transform = 'translateY(-1px)';
            saveBtn.style.boxShadow = '0 4px 16px rgba(74, 108, 247, 0.4)';
        });

        saveBtn.addEventListener('mouseleave', () => {
            saveBtn.style.transform = 'translateY(0)';
            saveBtn.style.boxShadow = '0 2px 8px rgba(74, 108, 247, 0.3)';
        });

        // Event listeners
        modal.querySelector('.comment-modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('.comment-btn-cancel').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('.comment-btn-save').addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (text) {
                const saved = await this.saveComment(coordinates, text);

                if (saved) {
                    // Reload all comments from database to ensure consistency
                    await this.loadProjectComments();
                    this.info('Comment added successfully');
                } else {
                    // Still display the comment locally even if save failed
                    this.displayComment({
                        coordinates,
                        text,
                        timestamp: new Date().toISOString(),
                        user: await this.getCurrentUsername()
                    });
                    this.warn('Comment added locally only');
                }
                document.body.removeChild(modal);
            }
        });

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });

        document.body.appendChild(modal);
        textarea.focus();
    }

    async saveComment(coordinates, text) {
        try {
            const projectId = this.getProjectId();

            if (!projectId) {
                this.error('No project ID available');
                return false;
            }

            // Ensure coordinates are in the correct format [lng, lat]
            const commentData = {
                project_id: parseInt(projectId),
                coordinates: coordinates,
                text: text,
                type: 'site_comment'
            };

            this.info('Saving comment with data:', commentData);

            const response = await fetch('/api/comments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(commentData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const result = await response.json();

            if (result.success) {
                this.info('Comment saved successfully to database');
                return true;
            } else {
                throw new Error(result.error || 'Failed to save comment');
            }
        } catch (error) {
            this.error('Failed to save comment:', error);
            this.warn('Failed to save comment to database, storing locally');
            return false;
        }
    }

    addCommentToMap(comment) {
        const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'comment-popup',
            anchor: 'bottom',
            offset: [0, -10]
        })
        .setLngLat(comment.coordinates)
        .setHTML(`
            <div class="comment-content" style="
                background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
                border: 1px solid rgba(0, 0, 0, 0.15);
                border-radius: 12px;
                padding: 16px;
                color: #1a1a1a;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
                backdrop-filter: blur(10px);
                min-width: 250px;
                max-width: 300px;
            ">
                <div class="comment-header" style="
                    margin-bottom: 10px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                ">
                    <span class="comment-user" style="
                        font-weight: 600;
                        font-size: 13px;
                        color: #4a6cf7;
                    ">${comment.user}</span>
                </div>
                <div class="comment-text" style="
                    font-size: 14px;
                    line-height: 1.5;
                    color: #1a1a1a;
                    margin-bottom: 12px;
                    word-wrap: break-word;
                ">${comment.text}</div>
                <div class="comment-actions" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <span class="comment-time" style="
                        font-size: 11px;
                        color: rgba(0, 0, 0, 0.6);
                    ">${this.formatTimestamp(comment.timestamp)}</span>
                    <button class="comment-delete-btn" onclick="window.siteInspectorCore?.commentsManager?.deleteComment('${comment.id}')" style="
                        background: rgba(220, 53, 69, 0.1);
                        border: 1px solid rgba(220, 53, 69, 0.3);
                        color: #dc3545;
                        padding: 6px 12px;
                        border-radius: 6px;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        font-weight: 500;
                    " onmouseenter="this.style.background='rgba(220, 53, 69, 0.15)'; this.style.borderColor='rgba(220, 53, 69, 0.5)'"
                       onmouseleave="this.style.background='rgba(220, 53, 69, 0.1)'; this.style.borderColor='rgba(220, 53, 69, 0.3)'">Delete</button>
                </div>
            </div>
        `)
        .addTo(this.map);

        // Store popup reference
        comment.popup = popup;
        this.commentPopups.push(popup);

        // Add comment marker
        this.addCommentMarker(comment);
    }

    addCommentMarker(comment) {
        const markerElement = document.createElement('div');
        markerElement.className = 'comment-marker';
        markerElement.innerHTML = '💬';
        markerElement.style.cssText = `
            width: 24px;
            height: 24px;
            background: #007cbf;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            cursor: pointer;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        `;

        const marker = new mapboxgl.Marker(markerElement)
            .setLngLat(comment.coordinates)
            .addTo(this.map);

        comment.marker = marker;

        // Click to show popup
        markerElement.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent map click from triggering
            if (comment.popup.isOpen()) {
                comment.popup.remove();
            } else {
                comment.popup.addTo(this.map);
            }
        });
    }

    async loadProjectComments() {
        try {
            const projectId = this.getProjectId();

            if (!projectId) {
                this.warn('No project ID available for loading comments');
                return;
            }

            this.info(`Loading comments for project ${projectId}`);

            const response = await fetch(`/api/comments?project_id=${projectId}&type=site_comment`);

            if (!response.ok) {
                const errorText = await response.text();
                this.warn(`Failed to load comments: ${response.status} - ${errorText}`);
                return;
            }

            const result = await response.json();

            if (result.success && result.comments) {
                this.info(`Loaded ${result.comments.length} comments from database`);

                // Clear existing comments
                this.clearComments();

                // Display each comment
                result.comments.forEach(comment => {
                    this.displayComment({
                        id: comment.id,
                        coordinates: comment.coordinates,
                        text: comment.text,
                        timestamp: comment.timestamp,
                        user: comment.user
                    });
                });

                this.info('Comments loaded and displayed successfully');
            } else {
                this.info('No comments found for this project');
            }
        } catch (error) {
            this.error('Error loading project comments:', error);
        }
    }

    showExistingComments() {
        this.comments.forEach(comment => {
            if (!comment.marker) {
                this.addCommentToMap(comment);
            }
        });
    }

    hideComments() {
        this.commentPopups.forEach(popup => {
            if (popup.remove) {
                popup.remove();
            }
        });

        this.comments.forEach(comment => {
            if (comment.marker) {
                comment.marker.remove();
            }
            if (comment.popup) {
                comment.popup.remove();
            }
        });
    }

    async deleteComment(commentId) {
        try {
            const projectId = this.getProjectId();
            if (projectId) {
                const response = await fetch(`/api/comments/${commentId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    this.info('Comment deleted from database');
                } else {
                    this.warn('Failed to delete comment from database');
                }
            }

            // Remove from local array and map
            const commentIndex = this.comments.findIndex(c => c.id == commentId);
            if (commentIndex !== -1) {
                const comment = this.comments[commentIndex];

                if (comment.marker) {
                    comment.marker.remove();
                }
                if (comment.popup) {
                    comment.popup.remove();
                }

                this.comments.splice(commentIndex, 1);
                this.info('Comment removed from map');
            }

        } catch (error) {
            this.error('Failed to delete comment:', error);
        }
    }

    getProjectId() {
        // Try multiple sources for project ID
        return this.projectId ||
               window.siteInspectorCore?.projectId ||
               sessionStorage.getItem('current_project_id') ||
               new URLSearchParams(window.location.search).get('project_id');
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    addCommentToolExitListeners() {
        const uiElements = [
            '#inspectorPanel',
            '#edgeSelectionButton',
            '#recalculateButton',
            '#uploadFloorplanButton',
            '#drawFloorplanButton',
            '#buildingsToggle',
            '#styleSelector',
            '#measureToolButton',
            '.boundary-option',
            '.setback-input'
        ];

        uiElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.addEventListener('click', this.handleUIClick);
            });
        });

        document.addEventListener('keydown', this.handleKeyDown);
    }

    removeCommentToolExitListeners() {
        const uiElements = [
            '#inspectorPanel',
            '#edgeSelectionButton',
            '#recalculateButton',
            '#uploadFloorplanButton',
            '#drawFloorplanButton',
            '#buildingsToggle',
            '#styleSelector',
            '#measureToolButton',
            '.boundary-option',
            '.setback-input'
        ];

        uiElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.removeEventListener('click', this.handleUIClick);
            });
        });

        document.removeEventListener('keydown', this.handleKeyDown);
    }

    handleUIClick = (e) => {
        // Only stop commenting if the event target is NOT within the comment modal itself.
        // This allows interaction with the modal (like typing in the textarea or clicking buttons).
        const commentModal = document.querySelector('.comment-modal');
        if (this.isCommenting && commentModal && !commentModal.contains(e.target)) {
            this.info('UI element clicked outside comment modal, stopping comments tool');
            this.stopCommenting();
        }
    }

    handleKeyDown = (e) => {
        if (this.isCommenting && e.key === 'Escape') {
            this.info('Escape pressed, stopping comments tool');
            this.stopCommenting();
        }
    }

    // Get all comments for dashboard integration
    getAllComments() {
        return this.comments;
    }

    // Cleanup method
    dispose() {
        this.info('Disposing Comments Manager...');

        if (this.isCommenting) {
            this.stopCommenting();
        }

        this.hideComments();
        this.removeCommentToolExitListeners();

        this.info('Comments Manager disposed');
    }

    // Helper to clear existing comments from the map and internal state
    clearComments() {
        this.hideComments();
        this.comments = [];
        this.commentPopups = [];
    }

    // Helper to get current username from user profile
    async getCurrentUsername() {
        try {
            const response = await fetch('/api/get-user-profile');
            if (response.ok) {
                const userData = await response.json();
                return userData.username || 'You';
            }
        } catch (error) {
            this.warn('Failed to get username:', error);
        }
        return 'You';
    }

    // Helper to display a comment on the map
    displayComment(commentData) {
        const comment = {
            ...commentData,
            id: commentData.id || Date.now().toString(), // Ensure a unique ID
            popup: null,
            marker: null
        };
        this.comments.push(comment);
        this.addCommentToMap(comment);
    }
}

// Export and make globally available
window.CommentsManager = CommentsManager;