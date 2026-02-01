"""
Configuration management for FPL Refresh Service.

Loads configuration from environment variables with sensible defaults.
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class Config:
    """Application configuration."""
    
    # Environment
    environment: str = os.getenv("ENVIRONMENT", "development")
    
    # Supabase Configuration
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_KEY", "")
    supabase_service_key: Optional[str] = os.getenv("SUPABASE_SERVICE_KEY", None)
    
    # FPL API Configuration
    fpl_api_base_url: str = os.getenv("FPL_API_BASE_URL", "https://fantasy.premierleague.com/api")
    
    # Rate Limiting
    max_requests_per_minute: int = int(os.getenv("MAX_REQUESTS_PER_MINUTE", "30"))
    min_request_interval: float = float(os.getenv("MIN_REQUEST_INTERVAL", "1.0"))
    
    # Retry Configuration
    max_retries: int = int(os.getenv("MAX_RETRIES", "3"))
    retry_backoff_base: float = float(os.getenv("RETRY_BACKOFF_BASE", "1.0"))
    max_retry_delay: int = int(os.getenv("MAX_RETRY_DELAY", "60"))
    
    # Refresh Intervals (in seconds)
    gameweeks_refresh_interval: int = int(os.getenv("GAMEWEEKS_REFRESH_INTERVAL", "45"))
    # Fast loop (gameweeks + fixtures + players) during live matches
    fast_loop_interval: int = int(os.getenv("FAST_LOOP_INTERVAL", "15"))
    # Slow loop (manager points + MVs) during live matches
    full_refresh_interval_live: int = int(os.getenv("FULL_REFRESH_INTERVAL_LIVE", "120"))
    fixtures_refresh_interval_live: int = int(os.getenv("FIXTURES_REFRESH_INTERVAL_LIVE", "30"))
    fixtures_refresh_interval_idle: int = int(os.getenv("FIXTURES_REFRESH_INTERVAL_IDLE", "600"))
    players_refresh_interval_live: int = int(os.getenv("PLAYERS_REFRESH_INTERVAL_LIVE", "60"))
    players_refresh_interval_bonus: int = int(os.getenv("PLAYERS_REFRESH_INTERVAL_BONUS", "120"))
    prices_refresh_interval_window: int = int(os.getenv("PRICES_REFRESH_INTERVAL_WINDOW", "30"))
    prices_refresh_interval_normal: int = int(os.getenv("PRICES_REFRESH_INTERVAL_NORMAL", "600"))
    
    # Price Change Window (PST timezone)
    price_change_time: str = os.getenv("PRICE_CHANGE_TIME", "17:30")  # 5:30 PM PST
    price_change_window_duration: int = int(os.getenv("PRICE_CHANGE_WINDOW_DURATION", "6"))  # 6 minutes (5:30-5:36 PM PST)
    
    # Cache Configuration
    bootstrap_cache_ttl: int = int(os.getenv("BOOTSTRAP_CACHE_TTL", "300"))  # 5 minutes
    fixtures_cache_ttl_live: int = int(os.getenv("FIXTURES_CACHE_TTL_LIVE", "30"))  # 30 seconds
    fixtures_cache_ttl_idle: int = int(os.getenv("FIXTURES_CACHE_TTL_IDLE", "600"))  # 10 minutes
    
    # Logging
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    log_format: str = os.getenv("LOG_FORMAT", "json")  # json or text
    
    def validate(self):
        """Validate configuration."""
        errors = []
        
        if not self.supabase_url:
            errors.append("SUPABASE_URL is required")
        if not self.supabase_key:
            errors.append("SUPABASE_KEY is required")
        
        if errors:
            raise ValueError(f"Configuration errors: {', '.join(errors)}")
        
        return True
    
    def __post_init__(self):
        """Validate after initialization."""
        self.validate()
