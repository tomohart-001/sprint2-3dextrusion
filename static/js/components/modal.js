
// Modal Component
class Modal {
    constructor(modalId) {
        this.modal = document.getElementById(modalId);
        this.closeButton = this.modal?.querySelector('.modal-close');
        
        if (this.modal) {
            this.init();
        }
    }
    
    init() {
        // Close button event
        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.close());
        }
        
        // Close on overlay click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });
        
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });
    }
    
    open() {
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        
        // Focus trap
        const focusableElements = this.modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
            focusableElements[0].focus();
        }
    }
    
    close() {
        this.modal.classList.remove('show');
        document.body.style.overflow = '';
    }
    
    isOpen() {
        return this.modal.classList.contains('show');
    }
}

// Initialize signup modal
document.addEventListener('DOMContentLoaded', () => {
    const signupModal = new Modal('signupModal');
    
    // Auto-show modal for non-logged-in users after 3 seconds
    const signupModalElement = document.getElementById('signupModal');
    if (signupModalElement) {
        setTimeout(() => {
            signupModal.open();
        }, 3000);
    }
});
