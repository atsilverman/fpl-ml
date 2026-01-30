# FPL Data Refresh Service

Backend service for synchronizing Fantasy Premier League data from the FPL API to Supabase.

## Setup

### 1. Install Dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Environment
ENVIRONMENT=development

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
SUPABASE_SERVICE_KEY=your_service_key  # Optional, for admin operations

# FPL API
FPL_API_BASE_URL=https://fantasy.premierleague.com/api

# Rate Limiting
MAX_REQUESTS_PER_MINUTE=30
MIN_REQUEST_INTERVAL=1.0

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json  # or "text" for development
```

### 3. Run Locally

```bash
python src/main.py
```

### 4. Deploy as Systemd Service

1. Copy service file:
```bash
sudo cp systemd/fpl-refresh.service /etc/systemd/system/
```

2. Create user and directories:
```bash
sudo useradd -r -s /bin/false fpl
sudo mkdir -p /opt/fpl-refresh
sudo chown -R fpl:fpl /opt/fpl-refresh
```

3. Copy code and create venv:
```bash
sudo cp -r backend /opt/fpl-refresh/
sudo cp .env /opt/fpl-refresh/
cd /opt/fpl-refresh
sudo -u fpl python3 -m venv venv
sudo -u fpl venv/bin/pip install -r backend/requirements.txt
```

4. Enable and start service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable fpl-refresh.service
sudo systemctl start fpl-refresh.service
```

5. Check status:
```bash
sudo systemctl status fpl-refresh.service
sudo journalctl -u fpl-refresh.service -f
```

## Project Structure

```
backend/
├── src/
│   ├── main.py              # Entry point
│   ├── config.py            # Configuration
│   ├── database/            # Supabase client
│   ├── fpl_api/             # FPL API client
│   ├── refresh/             # Refresh orchestration
│   ├── models/              # Data models
│   └── utils/                # Utilities
├── systemd/
│   └── fpl-refresh.service  # Systemd service file
├── requirements.txt
└── README.md
```

## Development

### Running Tests

```bash
pytest
```

### Code Formatting

```bash
black src/
```

### Type Checking

```bash
mypy src/
```
