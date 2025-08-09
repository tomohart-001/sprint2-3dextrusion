/**
 * Dashboard Core JavaScript Module
 *
 * Handles main dashboard functionality including:
 * - Search functionality
 * - Project filtering
 * - User dropdown management
 * - Team management
 * - Core initialization
 * - Project management and deletion
 */

class DashboardManager extends BaseManager {
    constructor() {
        super('DashboardManager');
        this.searchTimeout = null;
        this.initialized = false;

        // AbortControllers to easily remove listeners on re-init
        this.searchAbort = null;
        this.dropdownAbort = null;
        this.globalAbort = null;

        // Modal state
        this.pendingDeleteProjectId = null;
        this.pendingDeleteProjectName = null;
    }

    /**
     * Initialize the dashboard
     */
    async initialize() {
        if (this.initialized) {
            this.warn('Dashboard already initialized');
            return;
        }

        try {
            this.info('Initializing dashboard components');

            this.setupSearchFunctionality();
            this.setupUserDropdown();
            this.setupTeamManagement();
            this.setupEventListeners();
            this.setupDeleteModal();
            this.setupProjectCardOpenHandler();

            this.initialized = true;
            this.info('Dashboard initialization complete');
        } catch (error) {
            this.error('Failed to initialize dashboard', error);
            throw error;
        }
    }

    /**
     * Setup search functionality with debouncing (no cloneNode hack)
     */
    setupSearchFunctionality() {
        const input = document.getElementById('projectSearch');
        if (!input) {
            this.warn('Search input not found');
            return;
        }

        // Clean prior listeners
        if (this.searchAbort) this.searchAbort.abort();
        this.searchAbort = new AbortController();

        const handleSearch = this.debounce((e) => {
            const searchTerm = (e.target.value || '').toLowerCase().trim();
            this.filterProjects(searchTerm);
            if (window.dashboardTableManager?.filterTable) {
                window.dashboardTableManager.filterTable(searchTerm);
            }
        }, 300);

        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                this.filterProjects('');
                if (window.dashboardTableManager?.clearTableFilter) {
                    window.dashboardTableManager.clearTableFilter();
                }
            }
        };

        input.addEventListener('input', handleSearch, { signal: this.searchAbort.signal });
        input.addEventListener('keydown', handleKeydown, { signal: this.searchAbort.signal });

        this.debug('Search functionality initialized successfully');
    }

    /**
     * Debounce utility that preserves the instance context
     */
    debounce(func, wait) {
        let timeout;
        const ctx = this;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(ctx, args), wait);
        };
    }

    /**
     * Filter project list based on search input
     */
    filterProjects(searchTerm) {
        const cards = document.querySelectorAll('.project-card');
        let visibleCount = 0;

        cards.forEach(card => {
            const titleEl = card.querySelector('.project-card-title');
            const metaEl = card.querySelector('.project-card-meta');
            const statusEl = card.querySelector('.project-card-status');

            if (!titleEl || !metaEl || !statusEl) return;

            const titleText = (titleEl.textContent || '').toLowerCase();
            const metaText = (metaEl.textContent || '').toLowerCase();
            const statusText = (statusEl.textContent || '').toLowerCase();

            const isMatch =
                searchTerm === '' ||
                titleText.includes(searchTerm) ||
                metaText.includes(searchTerm) ||
                statusText.includes(searchTerm);

            if (isMatch) {
                // Prefer resetting to default display to play nice with CSS layouts
                card.style.display = '';
                visibleCount++;

                if (searchTerm !== '') {
                    card.style.backgroundColor = '#f0f9ff';
                    card.style.border = '2px solid #547bf7';
                } else {
                    card.style.backgroundColor = '';
                    card.style.border = '';
                }
            } else {
                card.style.display = 'none';
            }
        });

        this.debug(`Search filtered projects: ${visibleCount} visible of ${cards.length} total`);
    }

    /**
     * Setup user profile dropdown functionality (single listener set)
     */
    setupUserDropdown() {
        const toggle = document.getElementById('userProfileDropdownToggle');
        const menu = document.getElementById('userProfileDropdownMenu');

        if (!toggle || !menu) {
            this.warn('User dropdown elements not found');
            return;
        }

        // Clean prior listeners
        if (this.dropdownAbort) this.dropdownAbort.abort();
        this.dropdownAbort = new AbortController();
        const { signal } = this.dropdownAbort;

        const closeAll = () => {
            document.querySelectorAll('.user-dropdown-menu.show').forEach(m => m.classList.remove('show'));
            document.querySelectorAll('.user-dropdown-toggle.active').forEach(t => t.classList.remove('active'));
        };

        const onToggleClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isVisible = menu.classList.contains('show');
            closeAll();
            if (!isVisible) {
                toggle.classList.add('active');
                menu.classList.add('show');
                // Focus first focusable item for a11y if present
                const first = menu.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                first?.focus?.();
            }
        };

        const onDocClick = (e) => {
            if (!toggle.contains(e.target) && !menu.contains(e.target)) {
                closeAll();
            }
        };

        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                closeAll();
                toggle.focus?.();
            }
        };

        toggle.addEventListener('click', onToggleClick, { signal });
        document.addEventListener('click', onDocClick, { signal });
        document.addEventListener('keydown', onKeydown, { signal });
        menu.addEventListener('click', (e) => e.stopPropagation(), { signal });

        this.debug('User dropdown functionality initialized');
    }

    /**
     * Setup team management functionality
     */
    setupTeamManagement() {
        this.updateTeamMenuName();
        this.setupTeamModal();
    }

    /**
     * Update team menu name dynamically
     */
    async updateTeamMenuName() {
        try {
            const resp = await fetch('/api/get-team-name');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            const teamMenuText = document.getElementById('teamMenuText');
            const teamMenuItem = document.getElementById('teamMenuItem');
            const fileFilterSelect = document.getElementById('fileFilterSelect');

            if (data?.success && data.team_name) {
                teamMenuText && (teamMenuText.textContent = data.team_name, teamMenuText.title = data.team_name);
                if (teamMenuItem) teamMenuItem.style.display = 'flex';
                if (fileFilterSelect) fileFilterSelect.style.display = 'block';
                this.debug(`Team menu updated with name: ${data.team_name}`);
            } else {
                if (teamMenuItem) teamMenuItem.style.display = 'none';
                if (fileFilterSelect) fileFilterSelect.style.display = 'none';
            }
        } catch (error) {
            this.warn('Could not load team name', error);
            const teamMenuItem = document.getElementById('teamMenuItem');
            const fileFilterSelect = document.getElementById('fileFilterSelect');
            if (teamMenuItem) teamMenuItem.style.display = 'none';
            if (fileFilterSelect) fileFilterSelect.style.display = 'none';
        }
    }

    /**
     * Setup team creation modal
     */
    setupTeamModal() {
        const modal = document.getElementById('teamSetupModal');
        const closeBtn = document.getElementById('closeTeamSetup');
        const form = document.getElementById('teamSetupForm');

        if (!modal) {
            this.debug('No team setup modal on this page');
            return;
        }

        closeBtn?.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'block') {
                modal.style.display = 'none';
            }
        });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const fd = new FormData(form);
            const payload = {
                teamName: fd.get('teamName'),
                teamDescription: '',
                teamSize: fd.get('teamSize')
            };

            try {
                const response = await fetch('/api/setup-team', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                modal.style.display = 'none';
                await this.updateTeamMenuName();
                location.reload();
            } catch (error) {
                this.error('Team setup failed', error);
                alert('Failed to create team. Please try again.');
            }
        });

        this.debug('Team modal functionality initialized');
    }

    /**
     * Setup delete confirmation modal
     */
    setupDeleteModal() {
        const modal = document.getElementById('deleteProjectModal');
        if (!modal) {
            this.warn('Delete project modal not found');
            return;
        }

        // Close modal when clicking overlay background
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeDeleteModal();
        });

        // ESC closes
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isModalOpen(modal)) {
                this.closeDeleteModal();
            }
        });

        this.debug('Delete modal functionality initialized');
    }

    /**
     * Helper: is modal visible
     */
    isModalOpen(modal) {
        return modal && (modal.classList.contains('show') || modal.style.display === 'flex' || modal.style.display === 'block');
    }

    /**
     * Helper: show/hide delete modal with consistent styling
     */
    showDeleteModal(projectName) {
        const modal = document.getElementById('deleteProjectModal');
        if (!modal) return;

        const deleteNameSpan = document.getElementById('deleteProjectName');
        if (deleteNameSpan) deleteNameSpan.textContent = projectName;

        // Keep your existing inline styling approach for compatibility
        modal.classList.add('modal-overlay', 'show');
        modal.style.display = 'flex';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.zIndex = '9999';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.background = 'rgba(0, 0, 0, 0.6)';
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';

        const modalContent = modal.querySelector('.modal');
        if (modalContent) {
            modalContent.style.display = 'block';
            modalContent.style.transform = 'translateY(0)';
            modalContent.style.opacity = '1';
            modalContent.style.zIndex = '10001';
            modalContent.style.position = 'relative';
            modalContent.style.background = 'white';
            modalContent.style.borderRadius = '16px';
            modalContent.style.maxWidth = '520px';
            modalContent.style.width = '90%';
            modalContent.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.15)';
        }
    }

    closeDeleteModal() {
        const modal = document.getElementById('deleteProjectModal');
        if (modal) {
            modal.style.display = 'none';
            modal.style.justifyContent = '';
            modal.style.alignItems = '';
            modal.style.position = '';
            modal.style.top = '';
            modal.style.left = '';
            modal.style.width = '';
            modal.style.height = '';
            modal.style.zIndex = '';
            modal.style.background = '';
            modal.style.opacity = '';
            modal.style.visibility = '';
            modal.classList.remove('show', 'modal-overlay');

            const modalContent = modal.querySelector('.modal');
            if (modalContent) {
                modalContent.style.display = '';
                modalContent.style.transform = '';
                modalContent.style.opacity = '';
                modalContent.style.zIndex = '';
                modalContent.style.position = '';
                modalContent.style.background = '';
                modalContent.style.borderRadius = '';
                modalContent.style.maxWidth = '';
                modalContent.style.width = '';
                modalContent.style.boxShadow = '';
            }
        }
        this.pendingDeleteProjectId = null;
        this.pendingDeleteProjectName = null;
    }

    /**
     * Setup additional event listeners
     */
    setupEventListeners() {
        // Clean previous global listeners
        if (this.globalAbort) this.globalAbort.abort();
        this.globalAbort = new AbortController();
        const { signal } = this.globalAbort;

        // Project visibility radio button handling
        const visibilityRadios = document.querySelectorAll('input[name="projectVisibility"]');
        const teamMembersGroup = document.getElementById('teamMembersGroup');
        const teamMembersInput = document.getElementById('teamMembers');

        visibilityRadios.forEach(radio => {
            radio.addEventListener('change', function () {
                if (!teamMembersGroup) return;
                if (this.value === 'team') {
                    teamMembersGroup.style.display = 'block';
                } else {
                    teamMembersGroup.style.display = 'none';
                    if (teamMembersInput) teamMembersInput.value = '';
                }
            }, { signal });
        });

        this.debug('Additional event listeners initialized');
    }

    /**
     * Populate recent projects section
     */
    populateRecentProjects(projects) {
        const container = document.getElementById('recentProjectsContainer');
        const noProjectsMessage = container ? container.querySelector('.no-recent-projects') : null;

        if (!container) {
            this.warn('Recent projects container not found');
            return;
        }

        if (!projects || projects.length === 0) {
            if (noProjectsMessage) noProjectsMessage.style.display = 'flex';
            container.innerHTML = '';
            this.debug('No recent projects to display');
            return;
        }

        if (noProjectsMessage) noProjectsMessage.style.display = 'none';

        const recentProjects = projects
            .sort((a, b) => new Date(b.modified || b.created || 0) - new Date(a.modified || a.created || 0))
            .slice(0, 5);

        const html = recentProjects.map(project => {
            const type = project.type || project.status;
            const projectType = this.getProjectTypeClass(type);
            const icon = this.getProjectIcon(type);
            const projectName = this.escapeHtml(project.name || 'Untitled Project');
            const modifiedDate = project.modified || project.created || new Date().toISOString();
            const safeId = this.escapeHtml(String(project.id));

            return `
                <div class="project-card" data-project-id="${safeId}" style="cursor: pointer;">
                    <div class="project-card-header ${projectType}">
                        <div class="project-card-icon">${icon}</div>
                    </div>
                    <div class="project-card-content">
                        <h4 class="project-card-title">${projectName}</h4>
                        <p class="project-card-meta">Modified: ${this.formatDate(modifiedDate)}</p>
                        <span class="project-card-status ${project.status || 'active'}">${this.getStatusText(project.status || 'active')}</span>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
        this.debug(`Populated ${recentProjects.length} recent projects`);
    }

    /**
     * Delegated click handler for recent project cards
     */
    setupProjectCardOpenHandler() {
        const container = document.getElementById('recentProjectsContainer');
        if (!container) return;

        // Remove previous to avoid duplication
        container.replaceWith(container.cloneNode(true));
        const fresh = document.getElementById('recentProjectsContainer');
        if (!fresh) return;

        fresh.addEventListener('click', (e) => {
            const card = e.target.closest('.project-card');
            if (!card) return;
            const projectId = card.getAttribute('data-project-id');
            if (projectId) openProject(projectId);
        });
    }

    /**
     * Load projects from API
     */
    async loadAllProjects() {
        try {
            this.debug('Loading user projects from API...');
            const response = await fetch('/api/get-user-projects');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data?.success && Array.isArray(data.projects)) {
                this.debug(`Loaded ${data.projects.length} projects`);
                return data.projects;
            } else {
                this.warn('API returned invalid project data:', data);
                return [];
            }
        } catch (error) {
            this.error('Error loading projects', error);
            return [];
        }
    }

    /**
     * Refresh project lists after changes
     */
    async refreshProjectLists() {
        try {
            this.debug('Refreshing project lists from server...');
            const projects = await this.loadAllProjects();

            this.populateRecentProjects(projects);

            if (window.dashboardTableManager?.loadInitialData) {
                await window.dashboardTableManager.loadInitialData();
            }

            this.updateProjectCounter(projects.length);

            this.debug(`Project lists refreshed successfully with ${projects.length} projects`);
        } catch (error) {
            this.error('Failed to refresh project lists', error);
        }
    }

    /**
     * Delete project: show modal and store state
     */
    async deleteProject(projectId) {
        // Prevent multiple simultaneous delete requests
        if (this.pendingDeleteProjectId === projectId) {
            this.debug(`Delete already in progress for project ${projectId}`);
            return;
        }

        const row = document.querySelector(`tr[data-project-id="${CSS.escape(String(projectId))}"]`);
        const projectName = row ? (row.querySelector('.project-name-cell a')?.textContent || 'this project') : 'this project';

        this.pendingDeleteProjectId = projectId;
        this.pendingDeleteProjectName = projectName;

        this.showDeleteModal(projectName);
        this.info(`Showing delete confirmation modal for project: ${projectName}`);
    }

    /**
     * Confirm project deletion
     */
    async confirmDeleteProject() {
        if (!this.pendingDeleteProjectId) {
            this.debug('No pending delete project ID');
            return;
        }

        const projectId = this.pendingDeleteProjectId;
        const projectName = this.pendingDeleteProjectName;

        // Close modal and clear pending state immediately
        this.closeDeleteModal();

        try {
            this.debug(`Confirming deletion of project ${projectId}`);

            const response = await fetch(`/api/project/${encodeURIComponent(projectId)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const errorMessage = `Server error: ${response.status} ${response.statusText}`;
                this.error(errorMessage);
                throw new Error(errorMessage);
            }

            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                this.error(`Failed to parse delete response for project ${projectId}:`, parseError);
                throw new Error('Failed to parse server response');
            }

            if (data?.success) {
                this.info(`Project ${projectId} "${projectName}" deleted successfully from server`);
                this.removeProjectFromUI(projectId);
                await this.refreshProjectLists();
                this.info(`Project "${projectName}" deleted and UI updated successfully`);
                return;
            } else {
                const errorMessage = data?.error || 'Unknown server error';
                this.error(`Server reported failure for project ${projectId}: ${errorMessage}`);
                throw new Error(errorMessage);
            }
        } catch (error) {
            this.error(`Error deleting project ${projectId}:`, error);
            alert(`Error deleting project "${projectName}". Please try again.`);
            try { await this.refreshProjectLists(); } catch (refreshError) { this.error('Failed to refresh after delete error:', refreshError); }
        }
    }

    /**
     * Handle delete button clicks with debouncing/guarding
     */
    handleDeleteProject(projectId, buttonElement) {
        if (buttonElement) {
            if (buttonElement.disabled || buttonElement.classList.contains('deleting')) return;
            buttonElement.dataset.originalText = buttonElement.textContent;
            buttonElement.disabled = true;
            buttonElement.classList.add('deleting');
            buttonElement.textContent = '...';

            // Re-enable button after a delay in case modal is cancelled
            setTimeout(() => {
                if (buttonElement && !this.pendingDeleteProjectId) {
                    buttonElement.disabled = false;
                    buttonElement.classList.remove('deleting');
                    buttonElement.textContent = buttonElement.dataset.originalText || 'Delete';
                }
            }, 5000);
        }

        this.deleteProject(projectId);
    }

    /**
     * Remove project from UI immediately
     */
    removeProjectFromUI(projectId) {
        try {
            // Remove from table if table manager exists
            if (window.dashboardTableManager?.removeProjectFromTable) {
                window.dashboardTableManager.removeProjectFromTable(projectId);
            }

            // Remove from recent projects by data attribute
            document.querySelectorAll(`.project-card[data-project-id="${CSS.escape(String(projectId))}"]`)
                .forEach(card => card.remove());

            this.debug(`Removed project ${projectId} from UI immediately`);
        } catch (error) {
            this.error(`Error in removeProjectFromUI for project ${projectId}:`, error);
        }
    }

    /**
     * Update project counter in sidebar
     */
    updateProjectCounter(count) {
        const projectCounter = document.getElementById('projectCounter');
        if (projectCounter) {
            projectCounter.textContent = count;
        }
    }

    /**
     * Utility functions
     */
    escapeHtml(text) {
        if (text == null) return '';
        if (typeof text !== 'string') return String(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Unknown';
            return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return 'Unknown';
        }
    }

    getProjectTypeClass(type) {
        const typeMap = {
            'structural': 'structural',
            'structural-analyser': 'structural',
            'structure-designer': 'structural',
            'site': 'site',
            'site-selection': 'site',
            'site-inspector': 'site',
            'terrain-analysis': 'site',
            'building': 'building',
            'residential': 'building',
            'commercial': 'building',
            'industrial': 'building'
        };
        return typeMap[type] || 'building';
    }

    getProjectIcon(type) {
        const iconMap = {
            'structural': '🏗️',
            'structural-analyser': '⚙️',
            'structure-designer': '🏗️',
            'site': '🗺️',
            'site-selection': '📍',
            'site-inspector': '🔍',
            'terrain-analysis': '🏔️',
            'building': '🏢',
            'residential': '🏠',
            'commercial': '🏢',
            'industrial': '🏭'
        };
        return iconMap[type] || '📋';
    }

    getStatusText(status) {
        const statusMap = {
            'site-selection': 'Site Selection',
            'site-inspector': 'Site Inspector',
            'terrain-analysis': 'Terrain Analysis',
            'structure-designer': 'Structure Designer',
            'structural-analyser': 'Structural Analyser',
            'active': 'Active',
            'completed': 'Completed',
            'pending': 'Pending'
        };
        return statusMap[status] || (status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : 'Active');
    }
}

// Global functions needed by HTML
function openProject(projectId) {
    console.log(`[Dashboard] Opening project ${projectId}`);
    window.location.href = `/project/${encodeURIComponent(projectId)}`;
}

function shareProject(projectId) {
    console.log(`[Dashboard] Sharing project ${projectId}`);
    const row = document.querySelector(`tr[data-project-id="${CSS.escape(String(projectId))}"]`);
    const projectName = row ? (row.querySelector('.project-name-cell a')?.textContent || 'Project') : 'Project';
    const shareUrl = `${window.location.origin}/site-selection?project=${encodeURIComponent(projectId)}&shared=true`;

    navigator.clipboard.writeText(shareUrl).then(() => {
        alert(`Share link for "${projectName}" has been copied to your clipboard!`);
    }).catch(() => {
        prompt(`Share this link for "${projectName}":`, shareUrl);
    });
}

function deleteProject(projectId) {
    if (window.dashboardManager) {
        window.dashboardManager.deleteProject(projectId);
    }
}

function closeDeleteProjectModal() {
    if (window.dashboardManager) {
        window.dashboardManager.closeDeleteModal();
    }
}

function confirmDeleteProject() {
    if (window.dashboardManager) {
        window.dashboardManager.confirmDeleteProject();
    }
}

function handleDeleteProject(projectId, buttonElement) {
    if (window.dashboardManager) {
        window.dashboardManager.handleDeleteProject(projectId, buttonElement);
    }
}

async function refreshProjectLists() {
    if (window.dashboardManager) {
        await window.dashboardManager.refreshProjectLists();
    }

    // Re-enable all delete buttons after refresh
    document.querySelectorAll('.action-btn.delete.deleting').forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('deleting');
        btn.textContent = btn.dataset.originalText || 'Delete';
    });
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DashboardManager };
}