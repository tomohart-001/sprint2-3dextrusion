"""
Base Service Class
Provides common functionality for all services
"""
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional, Tuple
from utils.logger import app_logger


class BaseService(ABC):
    """Base class for all services with common functionality"""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.logger = app_logger
        self._cache = {}

    def clear_cache(self) -> None:
        """Clear service cache"""
        self._cache.clear()
        self.logger.info(f"{self.service_name} cache cleared")

    def _log_operation(self, operation: str, details: str = "") -> None:
        """Log service operations consistently"""
        message = f"{self.service_name} - {operation}"
        if details:
            message += f": {details}"
        self.logger.info(message)

    def _handle_error(self, operation: str, error: Exception) -> Tuple[str, str]:
        """Handle service errors with proper logging"""
        error_message = f"Error in {operation}: {str(error)}"

        # Log the error with context
        self.logger.error(error_message, error, {
            'operation': operation,
            'service': self.__class__.__name__
        })

        # Also log to Flask app logger if available
        try:
            from flask import current_app
            if current_app:
                current_app.logger.error(f"[{self.__class__.__name__}] {error_message}")
        except (ImportError, RuntimeError):
            # Flask context not available, skip additional logging
            pass

        return error_message, ""


class CacheableService(BaseService):
    """Service with enhanced caching capabilities"""

    def __init__(self, service_name: str, cache_ttl: int = 3600):
        super().__init__(service_name)
        self.cache_ttl = cache_ttl
        self._cache_timestamps = {}

    def _is_cache_valid(self, key: str) -> bool:
        """Check if cached data is still valid"""
        import time
        if key not in self._cache_timestamps:
            return False
        return (time.time() - self._cache_timestamps[key]) < self.cache_ttl

    def _set_cache(self, key: str, value: Any) -> None:
        """Set cache with timestamp"""
        import time
        self._cache[key] = value
        self._cache_timestamps[key] = time.time()

    def _get_cache(self, key: str) -> Optional[Any]:
        """Get cached value if valid"""
        if self._is_cache_valid(key):
            return self._cache.get(key)
        return None