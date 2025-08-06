/**
 * Site Inspector Utilities
 * Shared utility functions to reduce code duplication
 */

class SiteInspectorUtils {
    // Geometry utilities
    static calculatePolygonArea(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;

        let area = 0;
        const numPoints = coordinates.length - 1;

        for (let i = 0; i < numPoints; i++) {
            const j = (i + 1) % numPoints;
            area += coordinates[i][0] * coordinates[j][1];
            area -= coordinates[j][0] * coordinates[i][1];
        }

        return Math.abs(area) / 2;
    }

    // Debounce utility
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // DOM helper
    static createElement(tag, className = '', innerHTML = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (innerHTML) element.innerHTML = innerHTML;
        return element;
    }
}

// Make globally available
window.SiteInspectorUtils = SiteInspectorUtils;