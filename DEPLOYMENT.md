# Deployment Guide

## Backend Deployment (Digital Ocean)

### 1. Set Up Droplet

1. Create a new Digital Ocean droplet (Ubuntu 22.04 LTS)
2. SSH into the droplet
3. Update system:
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Dependencies

```bash
# Install Python 3.11+
sudo apt install python3.11 python3.11-venv python3-pip -y

# Install PostgreSQL client (if needed)
sudo apt install postgresql-client -y
```

### 3. Set Up Application

```bash
# Create user
sudo useradd -r -s /bin/false fpl

# Create directories
sudo mkdir -p /opt/fpl-refresh
sudo chown -R fpl:fpl /opt/fpl-refresh

# Clone repo (root at /opt/fpl-refresh so backend is at /opt/fpl-refresh/backend)
sudo -u fpl git clone <your-repo> /opt/fpl-refresh
# Or copy files so backend app lives at /opt/fpl-refresh/backend
```

### 4. Set Up Python Environment

```bash
cd /opt/fpl-refresh
sudo -u fpl python3.11 -m venv venv
sudo -u fpl venv/bin/pip install -r backend/requirements.txt
```

### 5. Configure Environment

```bash
sudo -u fpl cp backend/.env.example /opt/fpl-refresh/.env
sudo -u fpl nano /opt/fpl-refresh/.env
# Edit with your credentials
```

### 6. Install Systemd Service

```bash
sudo cp backend/systemd/fpl-refresh.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable fpl-refresh.service
sudo systemctl start fpl-refresh.service
```

### 7. Check Status

```bash
sudo systemctl status fpl-refresh.service
sudo journalctl -u fpl-refresh.service -f
```

### 8. Deploy updates to production (main → droplet)

After pushing changes to `main`, deploy to the Digital Ocean droplet:

**Option A – run on the droplet (SSH in first):**

```bash
# SSH into your droplet, then (repo root = /opt/fpl-refresh):
cd /opt/fpl-refresh
sudo -u fpl git fetch origin && sudo -u fpl git checkout main && sudo -u fpl git pull origin main
sudo -u fpl /opt/fpl-refresh/venv/bin/pip install -r /opt/fpl-refresh/backend/requirements.txt --quiet
sudo systemctl restart fpl-refresh.service
sudo systemctl status fpl-refresh.service
```

**Option B – one-liner from your machine (replace DROPLET_IP):**

```bash
ssh root@DROPLET_IP 'cd /opt/fpl-refresh && sudo -u fpl git fetch origin && sudo -u fpl git checkout main && sudo -u fpl git pull origin main && sudo -u fpl /opt/fpl-refresh/venv/bin/pip install -r /opt/fpl-refresh/backend/requirements.txt --quiet && sudo systemctl restart fpl-refresh.service && sudo systemctl status fpl-refresh.service'
```

**Option C – use the deploy script on the server:**

```bash
# On the droplet (after copying or pulling the script):
sudo bash /opt/fpl-refresh/backend/scripts/deploy.sh
```

After deploy, confirm the service is running and check logs:

```bash
sudo systemctl status fpl-refresh.service
sudo journalctl -u fpl-refresh.service -f
```

## Frontend Deployment (Vercel)

### 1. Prepare Repository

- Push code to GitHub
- Ensure `frontend/` directory is in repository

### 2. Deploy to Vercel

1. Go to [Vercel Dashboard](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Configure project:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_MANAGER_ID` (optional)
   - `VITE_LEAGUE_ID` (optional)
6. Click "Deploy"

### 3. Custom Domain (Optional)

1. Go to project settings
2. Add custom domain
3. Configure DNS as instructed

## Database Setup (Supabase)

### 1. Create Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com)
2. Create new project
3. Note your project URL and anon key

### 2. Run Migrations

1. Go to SQL Editor in Supabase dashboard
2. Run migrations in order:
   - `backend/supabase/migrations/001_create_tables.sql`
   - `backend/supabase/migrations/002_create_materialized_views.sql`
   - `backend/supabase/migrations/003_create_refresh_functions.sql`

### 3. Configure RLS (if needed)

Set up Row Level Security policies if you need multi-tenant support.

## Monitoring

### Backend Monitoring

- Check service status: `sudo systemctl status fpl-refresh.service`
- View logs: `sudo journalctl -u fpl-refresh.service -f`
- Check for errors: `sudo journalctl -u fpl-refresh.service --since "1 hour ago" | grep ERROR`

### Frontend Monitoring

- Vercel provides built-in analytics
- Check deployment logs in Vercel dashboard
- Monitor Supabase egress usage in Supabase dashboard

## Troubleshooting

### Backend Issues

- **Service won't start**: Check logs with `journalctl -u fpl-refresh.service`
- **Import errors**: Ensure all dependencies installed in venv
- **Database connection errors**: Verify Supabase credentials in `.env`

### Frontend Issues

- **Build failures**: Check Vercel build logs
- **Environment variables**: Verify all required vars are set in Vercel
- **Supabase connection**: Verify Supabase URL and key are correct
