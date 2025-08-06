
// User Dropdown Component
class UserDropdown {
    constructor() {
        this.toggle = document.getElementById('userDropdownToggle');
        this.menu = document.getElementById('userDropdownMenu');
        
        if (this.toggle && this.menu) {
            this.init();
        }
    }
    
    init() {
        this.toggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMenu();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.toggle.contains(e.target) && !this.menu.contains(e.target)) {
                this.closeMenu();
            }
        });
        
        // Close dropdown on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeMenu();
            }
        });
    }
    
    toggleMenu() {
        const isOpen = this.menu.classList.contains('show');
        if (isOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }
    
    openMenu() {
        this.menu.classList.add('show');
        this.toggle.classList.add('active');
        this.toggle.setAttribute('aria-expanded', 'true');
    }
    
    closeMenu() {
        this.menu.classList.remove('show');
        this.toggle.classList.remove('active');
        this.toggle.setAttribute('aria-expanded', 'false');
    }
}

// Initialize dropdown when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new UserDropdown();
});
