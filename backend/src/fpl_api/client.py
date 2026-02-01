"""
FPL API Client with rate limiting, retry logic, and error handling.

Handles all communication with the Fantasy Premier League API.
"""

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx
from asyncio_throttle import Throttler

from config import Config

logger = logging.getLogger(__name__)


class FPLAPIError(Exception):
    """Base exception for FPL API errors."""
    pass


class FPLAPIRateLimitError(FPLAPIError):
    """Raised when rate limit is exceeded."""
    pass


class FPLAPINonRetryableError(FPLAPIError):
    """Raised for non-retryable errors (4xx except 429)."""
    pass


class FPLAPIClient:
    """Client for interacting with the FPL API."""
    
    def __init__(self, config: Config):
        self.config = config
        self.base_url = config.fpl_api_base_url
        self.max_retries = config.max_retries
        self.retry_backoff_base = config.retry_backoff_base
        self.max_retry_delay = config.max_retry_delay
        
        # Rate limiting: max 30 req/min, min 1 sec between requests
        self.throttler = Throttler(
            rate_limit=config.max_requests_per_minute,
            period=60.0
        )
        self.min_interval = config.min_request_interval
        self.last_request_time = 0.0
        
        # Cache for bootstrap-static
        self._bootstrap_cache: Optional[Dict[str, Any]] = None
        self._bootstrap_cache_time: Optional[datetime] = None
        self._bootstrap_cache_ttl = timedelta(seconds=config.bootstrap_cache_ttl)
        
        # HTTP client (no base_url to avoid issues with URL construction)
        self.client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://fantasy.premierleague.com/"
            }
        )
    
    async def _wait_for_rate_limit(self):
        """Wait to respect rate limiting."""
        await self.throttler.acquire()
        
        # Also enforce minimum interval between requests
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        if time_since_last < self.min_interval:
            wait_time = self.min_interval - time_since_last
            # Add jitter (±25%)
            jitter = wait_time * 0.25 * (random.random() * 2 - 1)
            await asyncio.sleep(wait_time + jitter)
        
        self.last_request_time = time.time()
    
    def _is_retryable_error(self, status_code: int) -> bool:
        """Check if error is retryable."""
        # Retryable: 429 (rate limit), 500, 502, 503, 504
        # Non-retryable: 400, 401, 403, 404
        retryable_codes = {429, 500, 502, 503, 504}
        return status_code in retryable_codes
    
    async def _request_with_retry(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> httpx.Response:
        """
        Make HTTP request with retry logic.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path
            **kwargs: Additional arguments for httpx request
            
        Returns:
            httpx.Response object
            
        Raises:
            FPLAPIRateLimitError: If rate limited
            FPLAPINonRetryableError: If non-retryable error
            FPLAPIError: For other errors after retries exhausted
        """
        # Construct full URL
        if endpoint.startswith("http"):
            url = endpoint
        else:
            # Ensure proper URL joining
            base = self.base_url.rstrip("/")
            endpoint = endpoint.lstrip("/")
            url = f"{base}/{endpoint}"
        last_exception = None
        
        for attempt in range(self.max_retries + 1):
            try:
                # Wait for rate limit
                await self._wait_for_rate_limit()
                
                # Make request with explicit headers
                request_headers = {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "application/json",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://fantasy.premierleague.com/"
                }
                # Merge with any headers from kwargs
                if "headers" in kwargs:
                    request_headers.update(kwargs["headers"])
                kwargs["headers"] = request_headers
                
                # Make request
                response = await self.client.request(method, url, **kwargs)
                
                # Check status code
                if response.is_success:
                    return response
                
                status_code = response.status_code
                
                # Handle rate limiting
                if status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", 60))
                    logger.warning(
                        "Rate limited by FPL API",
                        extra={
                            "endpoint": endpoint,
                            "retry_after": retry_after,
                            "attempt": attempt + 1
                        }
                    )
                    if attempt < self.max_retries:
                        await asyncio.sleep(retry_after)
                        continue
                    raise FPLAPIRateLimitError(
                        f"Rate limited after {self.max_retries} retries"
                    )
                
                # Handle non-retryable errors
                if not self._is_retryable_error(status_code):
                    error_text = response.text[:500]  # Limit error text length
                    logger.error(
                        "Non-retryable error from FPL API",
                        extra={
                            "endpoint": endpoint,
                            "status_code": status_code,
                            "error": error_text
                        }
                    )
                    raise FPLAPINonRetryableError(
                        f"Non-retryable error {status_code}: {error_text}"
                    )
                
                # Retryable error - calculate backoff
                if attempt < self.max_retries:
                    backoff = min(
                        self.retry_backoff_base * (2 ** attempt),
                        self.max_retry_delay
                    )
                    # Add jitter (±25%)
                    jitter = backoff * 0.25 * (random.random() * 2 - 1)
                    wait_time = backoff + jitter
                    
                    logger.warning(
                        "Retryable error from FPL API, retrying",
                        extra={
                            "endpoint": endpoint,
                            "status_code": status_code,
                            "attempt": attempt + 1,
                            "wait_time": wait_time
                        }
                    )
                    await asyncio.sleep(wait_time)
                    continue
                
                # Exhausted retries
                error_text = response.text[:500]
                raise FPLAPIError(
                    f"Request failed after {self.max_retries} retries: "
                    f"{status_code} - {error_text}"
                )
                
            except httpx.TimeoutException as e:
                last_exception = e
                if attempt < self.max_retries:
                    backoff = min(
                        self.retry_backoff_base * (2 ** attempt),
                        self.max_retry_delay
                    )
                    jitter = backoff * 0.25 * (random.random() * 2 - 1)
                    logger.warning(
                        "Timeout from FPL API, retrying",
                        extra={
                            "endpoint": endpoint,
                            "attempt": attempt + 1,
                            "wait_time": backoff + jitter
                        }
                    )
                    await asyncio.sleep(backoff + jitter)
                    continue
                raise FPLAPIError(f"Request timeout after {self.max_retries} retries") from e
            
            except httpx.NetworkError as e:
                last_exception = e
                if attempt < self.max_retries:
                    backoff = min(
                        self.retry_backoff_base * (2 ** attempt),
                        self.max_retry_delay
                    )
                    jitter = backoff * 0.25 * (random.random() * 2 - 1)
                    logger.warning(
                        "Network error from FPL API, retrying",
                        extra={
                            "endpoint": endpoint,
                            "attempt": attempt + 1,
                            "wait_time": backoff + jitter,
                            "error": str(e)
                        }
                    )
                    await asyncio.sleep(backoff + jitter)
                    continue
                raise FPLAPIError(f"Network error after {self.max_retries} retries") from e
        
        # Should not reach here, but just in case
        raise FPLAPIError("Request failed") from last_exception
    
    async def get_bootstrap_static(self, use_cache: bool = True) -> Dict[str, Any]:
        """
        Get bootstrap-static data (players, teams, gameweeks).
        
        Args:
            use_cache: Whether to use cached data if available
            
        Returns:
            Bootstrap static data dictionary
        """
        # Check cache
        if use_cache and self._bootstrap_cache is not None:
            if self._bootstrap_cache_time is not None:
                age = datetime.now(timezone.utc) - self._bootstrap_cache_time
                if age < self._bootstrap_cache_ttl:
                    logger.debug("Using cached bootstrap-static data", extra={
                        "cache_age_seconds": age.total_seconds()
                    })
                    return self._bootstrap_cache
        
        # Fetch fresh data
        response = await self._request_with_retry("GET", "/bootstrap-static/")
        
        # Check if response has content
        if not response.content:
            logger.error("Bootstrap-static empty", extra={
                "status_code": response.status_code,
                "headers": dict(response.headers)
            })
            raise FPLAPIError("Empty response from bootstrap-static")
        
        # Check if we got HTML instead of JSON (likely a redirect or blocking)
        content_type = response.headers.get('content-type', '').lower()
        if 'text/html' in content_type:
            logger.error("API returned HTML (blocking?)", extra={
                "url": str(response.url),
                "status_code": response.status_code,
                "content_type": content_type
            })
            raise FPLAPIError("FPL API returned HTML instead of JSON - request may be blocked")
        
        try:
            data = response.json()
        except Exception as e:
            # Log detailed error information
            error_info = {
                "status_code": response.status_code,
                "content_length": len(response.content) if response.content else 0,
                "content_type": response.headers.get("content-type", "unknown"),
                "error": str(e)
            }
            if response.text:
                error_info["response_preview"] = response.text[:500]
            else:
                error_info["response_preview"] = "No text content"
            
            logger.error("JSON parse failed", extra=error_info)
            raise FPLAPIError(f"Failed to parse JSON: {e}") from e
        
        # Update cache
        self._bootstrap_cache = data
        self._bootstrap_cache_time = datetime.now(timezone.utc)
        
        logger.info("Bootstrap-static fetched", extra={
            "players_count": len(data.get("elements", [])),
            "teams_count": len(data.get("teams", [])),
            "gameweeks_count": len(data.get("events", []))
        })
        
        return data
    
    async def get_fixtures(self) -> List[Dict[str, Any]]:
        """
        Get all fixtures.
        
        Returns:
            List of fixture dictionaries
        """
        response = await self._request_with_retry("GET", "/fixtures/")
        fixtures = response.json()
        
        logger.debug("Fetched fixtures", extra={
            "fixtures_count": len(fixtures)
        })
        
        return fixtures
    
    async def get_event_live(self, gameweek: int) -> Dict[str, Any]:
        """
        Get live event data for a gameweek.
        
        Args:
            gameweek: Gameweek number
            
        Returns:
            Live event data dictionary
        """
        response = await self._request_with_retry("GET", f"/event/{gameweek}/live")
        data = response.json()
        
        logger.debug("Fetched live event data", extra={
            "gameweek": gameweek,
            "players_count": len(data.get("elements", []))
        })
        
        return data
    
    async def get_element_summary(self, player_id: int) -> Dict[str, Any]:
        """
        Get element (player) summary data.
        
        Args:
            player_id: FPL player ID
            
        Returns:
            Player summary data dictionary
        """
        response = await self._request_with_retry("GET", f"/element-summary/{player_id}/")
        data = response.json()
        
        return data
    
    async def get_entry(self, manager_id: int) -> Dict[str, Any]:
        """
        Get manager entry data.
        
        Args:
            manager_id: FPL manager ID
            
        Returns:
            Manager entry data dictionary
        """
        response = await self._request_with_retry("GET", f"/entry/{manager_id}/")
        data = response.json()
        
        return data
    
    async def get_entry_history(self, manager_id: int) -> Dict[str, Any]:
        """
        Get manager history data.
        
        Args:
            manager_id: FPL manager ID
            
        Returns:
            Manager history data dictionary
        """
        response = await self._request_with_retry("GET", f"/entry/{manager_id}/history/")
        data = response.json()
        
        return data
    
    async def get_entry_picks(
        self,
        manager_id: int,
        gameweek: int
    ) -> Dict[str, Any]:
        """
        Get manager picks for a gameweek.
        
        Args:
            manager_id: FPL manager ID
            gameweek: Gameweek number
            
        Returns:
            Manager picks data dictionary
        """
        response = await self._request_with_retry(
            "GET",
            f"/entry/{manager_id}/event/{gameweek}/picks/"
        )
        data = response.json()
        
        return data
    
    async def get_entry_transfers(self, manager_id: int) -> List[Dict[str, Any]]:
        """
        Get manager transfers.
        
        Args:
            manager_id: FPL manager ID
            
        Returns:
            List of transfer dictionaries
        """
        response = await self._request_with_retry("GET", f"/entry/{manager_id}/transfers/")
        transfers = response.json()
        
        return transfers
    
    async def get_league_standings(
        self,
        league_id: int,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        Get league standings.
        
        Args:
            league_id: FPL league ID
            page: Page number (default 1)
            
        Returns:
            League standings data dictionary
        """
        response = await self._request_with_retry(
            "GET",
            f"/leagues-classic/{league_id}/standings/?page_standings={page}"
        )
        data = response.json()
        
        return data
    
    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
    
    async def __aenter__(self):
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
