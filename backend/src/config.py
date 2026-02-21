"""
Configuration management for FPL Refresh Service.

Loads configuration from environment variables with sensible defaults.
"""

import os
from dataclasses import dataclass, field
from typing import List, Optional


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
    gameweeks_refresh_interval: int = int(os.getenv("GAMEWEEKS_REFRESH_INTERVAL", "15"))
    # Fast loop (gameweeks + fixtures + players); shorter during live so minutes/points stay current
    fast_loop_interval: int = int(os.getenv("FAST_LOOP_INTERVAL", "15"))
    # Live: default 10s; set FAST_LOOP_INTERVAL_LIVE=8 for faster updates if server/DB can handle it
    fast_loop_interval_live: int = int(os.getenv("FAST_LOOP_INTERVAL_LIVE", "10"))
    # Post-deadline: poll gameweeks every N seconds to detect is_next → is_current and API return ASAP
    fast_loop_interval_deadline: int = int(os.getenv("FAST_LOOP_INTERVAL_DEADLINE", "15"))
    # Kickoff window: use short interval when now is within N minutes of any fixture kickoff (multi-day GW: Sat–Mon)
    kickoff_window_minutes: int = int(os.getenv("KICKOFF_WINDOW_MINUTES", "5"))
    # When in gameweek (IDLE), never sleep longer than this so we detect live/kickoff within ~1 min (match API cadence)
    max_idle_sleep_seconds: int = int(os.getenv("MAX_IDLE_SLEEP_SECONDS", "60"))
    # Post-deadline: wait N seconds before starting batch (lets API endpoints settle); keep short so fast loop isn't blocked long
    post_deadline_settle_seconds: int = int(os.getenv("POST_DEADLINE_SETTLE_SECONDS", "60"))
    # Post-deadline: picks+transfers batch size (managers per batch) and sleep between batches (seconds)
    deadline_batch_size: int = int(os.getenv("DEADLINE_BATCH_SIZE", "15"))
    deadline_batch_sleep_seconds: float = float(os.getenv("DEADLINE_BATCH_SLEEP_SECONDS", "1.0"))
    # Manager points refresh (all tracked managers): batch size and sleep between batches (aggressive defaults; increase sleep if 429s)
    manager_points_batch_size: int = int(os.getenv("MANAGER_POINTS_BATCH_SIZE", "10"))
    manager_points_batch_sleep_seconds: float = float(os.getenv("MANAGER_POINTS_BATCH_SLEEP_SECONDS", "0.5"))
    # Post-deadline: run picks+transfers batch for this many minutes so transfers endpoint has time to update (FPL can lag vs is_current)
    deadline_refresh_window_minutes: int = int(os.getenv("DEADLINE_REFRESH_WINDOW_MINUTES", "45"))
    # Slow loop (manager points + MVs) during live matches — 60s for responsive standings
    full_refresh_interval_live: int = int(os.getenv("FULL_REFRESH_INTERVAL_LIVE", "60"))
    # In fast cycle when live: run live standings (manager points + ranks + MVs) at most every N seconds so most
    # fast cycles stay short and "Since backend" updates every ~10–30s instead of every 6+ min
    live_standings_in_fast_interval_seconds: int = int(os.getenv("LIVE_STANDINGS_IN_FAST_INTERVAL", "90"))
    fixtures_refresh_interval_live: int = int(os.getenv("FIXTURES_REFRESH_INTERVAL_LIVE", "30"))
    fixtures_refresh_interval_idle: int = int(os.getenv("FIXTURES_REFRESH_INTERVAL_IDLE", "600"))
    players_refresh_interval_live: int = int(os.getenv("PLAYERS_REFRESH_INTERVAL_LIVE", "60"))
    players_refresh_interval_bonus: int = int(os.getenv("PLAYERS_REFRESH_INTERVAL_BONUS", "120"))
    prices_refresh_interval_window: int = int(os.getenv("PRICES_REFRESH_INTERVAL_WINDOW", "30"))
    prices_refresh_interval_normal: int = int(os.getenv("PRICES_REFRESH_INTERVAL_NORMAL", "600"))
    
    # Price Change Window (PST timezone)
    price_change_time: str = os.getenv("PRICE_CHANGE_TIME", "17:30")  # 5:30 PM PST
    price_change_window_duration: int = int(os.getenv("PRICE_CHANGE_WINDOW_DURATION", "6"))  # 6 minutes (5:30-5:36 PM PST)
    # After price window closes, run manager refresh for this many minutes to capture post–price-change team value
    price_window_cooldown_minutes: int = int(os.getenv("PRICE_WINDOW_COOLDOWN_MINUTES", "5"))

    # Rank monitoring: after last game of the match day, poll FPL for rank updates for this many hours (FPL can update at undocumented times)
    rank_monitor_hours_after_last_matchday: int = int(os.getenv("RANK_MONITOR_HOURS_AFTER_LAST_MATCHDAY", "5"))
    rank_monitor_interval_seconds: int = int(os.getenv("RANK_MONITOR_INTERVAL_SECONDS", "900"))  # 15 minutes
    
    # Cache Configuration
    bootstrap_cache_ttl: int = int(os.getenv("BOOTSTRAP_CACHE_TTL", "300"))  # 5 minutes
    fixtures_cache_ttl_live: int = int(os.getenv("FIXTURES_CACHE_TTL_LIVE", "30"))  # 30 seconds
    fixtures_cache_ttl_idle: int = int(os.getenv("FIXTURES_CACHE_TTL_IDLE", "600"))  # 10 minutes
    
    # Optional: manager IDs to always include in deadline batch (e.g. home page or app-configured managers).
    # Set REQUIRED_MANAGER_IDS (comma-separated) and/or VITE_MANAGER_ID so the deadline batch
    # refreshes picks/transfers for these managers even if not in mini_league_managers.
    # The batch already runs for all managers in all tracked leagues (mini_league_managers).
    required_manager_ids: List[int] = field(default_factory=list)

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
        ids: List[int] = []
        raw_list = os.getenv("REQUIRED_MANAGER_IDS")
        if raw_list:
            for s in raw_list.split(","):
                s = s.strip()
                if s:
                    try:
                        ids.append(int(s))
                    except ValueError:
                        pass
        single = os.getenv("REQUIRED_MANAGER_ID") or os.getenv("VITE_MANAGER_ID")
        if single:
            try:
                mid = int(single)
                if mid not in ids:
                    ids.append(mid)
            except ValueError:
                pass
        self.required_manager_ids = ids if ids else []
        self.validate()
