
// Main JavaScript for EngineRoom
class EngineRoom {
    constructor() {
        this.init();
    }
    
    init() {
        this.setupSmoothScrolling();
        this.setupCTAButtons();
        this.setupAccessibility();
    }
    
    setupSmoothScrolling() {
        // Smooth scroll for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    }
    
    setupCTAButtons() {
        // Add click tracking for CTA buttons
        document.querySelectorAll('.primary-cta, .secondary-cta').forEach(button => {
            button.addEventListener('click', function() {
                // Add analytics tracking here if needed
                console.log('CTA clicked:', this.textContent);
            });
        });
    }
    
    setupAccessibility() {
        // Add keyboard navigation support
        document.addEventListener('keydown', (e) => {
            // Add any global keyboard shortcuts here
            if (e.key === '/' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                // Focus search if available
                const searchInput = document.querySelector('input[type="search"]');
                if (searchInput) {
                    searchInput.focus();
                }
            }
        });
        
        // Add focus indicators for keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                document.body.classList.add('keyboard-navigation');
            }
        });
        
        document.addEventListener('mousedown', () => {
            document.body.classList.remove('keyboard-navigation');
        });
    }
}

// Initialize EngineRoom when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new EngineRoom();
});

// Add keyboard navigation styles
const style = document.createElement('style');
style.textContent = `
    .keyboard-navigation *:focus {
        outline: 2px solid #547bf7 !important;
        outline-offset: 2px !important;
    }
`;
document.head.appendChild(style);
