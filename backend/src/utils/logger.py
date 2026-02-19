"""
Logging configuration for FPL Refresh Service.

Provides structured JSON logging for production and readable text logging for development.
"""

import json
import logging
import sys
from datetime import datetime
from typing import Any, Dict


class JSONFormatter(logging.Formatter):
    """JSON formatter for structured logging."""
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_data: Dict[str, Any] = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        
        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        
        # Add extra fields from record
        if hasattr(record, "extra"):
            log_data.update(record.extra)
        
        # Add any additional attributes
        for key, value in record.__dict__.items():
            if key not in ["name", "msg", "args", "created", "filename", "funcName",
                          "levelname", "levelno", "lineno", "module", "msecs", "message",
                          "pathname", "process", "processName", "relativeCreated", "thread",
                          "threadName", "exc_info", "exc_text", "stack_info", "extra"]:
                if not key.startswith("_"):
                    log_data[key] = value
        
        return json.dumps(log_data)
    
    def formatException(self, exc_info):
        """Format exception as string."""
        import traceback
        return traceback.format_exception(*exc_info)


def setup_logging(config=None, log_file=None):
    """
    Set up logging configuration.

    Args:
        config: Optional Config object. If None, uses environment variables.
        log_file: Optional path (str or Path) to also write logs to a file (append mode).
    """
    import os
    from pathlib import Path

    log_level = os.getenv("LOG_LEVEL", "INFO")
    log_format = os.getenv("LOG_FORMAT", "json")

    if config:
        log_level = config.log_level
        log_format = config.log_format

    # Set root logger level
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))

    # Remove existing handlers
    root_logger.handlers.clear()

    # Set formatter (shared by console and optional file)
    if log_format == "json":
        formatter = JSONFormatter()
    else:
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )

    # Console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(getattr(logging, log_level.upper()))
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Optional file handler (append mode)
    if log_file is not None:
        path = Path(log_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(path, mode="a", encoding="utf-8")
        file_handler.setLevel(getattr(logging, log_level.upper()))
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    # Set levels for third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
