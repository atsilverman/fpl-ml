# Digital Ocean Droplet Setup (from scratch)

Use this to run the FPL refresh backend **24/7** on a droplet so your **prod site (Vercel)** stays updated with fresh data from the FPL API. You can keep developing locally; the droplet will maintain Supabase so prod always has current standings, players, and fixtures.

Follow these steps in order to get the FPL refresh service running on a new droplet.

---

## 1. Create the droplet

1. In [Digital Ocean](https://cloud.digitalocean.com/droplets/new):
   - **Image:** Ubuntu 22.04 LTS
   - **Plan:** Basic shared CPU (e.g. $6/mo) is enough
   - **Authentication:** SSH key (recommended) or password
   - **Hostname:** e.g. `fpl-refresh`
2. Create the droplet and note the **IP address**.

---

## 2. SSH in and update the system

```bash
ssh root@YOUR_DROPLET_IP
```

Then:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 3. Install Python and tools

```bash
sudo apt install -y python3.11 python3.11-venv python3-pip git
```

---

## 4. Create app user and directory

```bash
sudo useradd -r -s /bin/false fpl
sudo mkdir -p /opt/fpl-refresh
sudo chown -R fpl:fpl /opt/fpl-refresh
```

---

## 5. Clone the repo

Replace `YOUR_GITHUB_REPO` with your repo URL (HTTPS or SSH), e.g.  
`https://github.com/yourusername/fpl-new.git` or `git@github.com:yourusername/fpl-new.git`

```bash
sudo -u fpl git clone YOUR_GITHUB_REPO /opt/fpl-refresh
```

If the repo is private and you use SSH:
- Add your deploy key to the repo, or
- Clone as root first with your SSH key, then `chown -R fpl:fpl /opt/fpl-refresh`

---

## 6. Create virtualenv and install dependencies

```bash
cd /opt/fpl-refresh
sudo -u fpl python3.11 -m venv venv
sudo -u fpl /opt/fpl-refresh/venv/bin/pip install -r /opt/fpl-refresh/backend/requirements.txt
```

---

## 7. Configure environment (.env)

Create `.env` from the example and edit it with your real values:

```bash
sudo -u fpl cp /opt/fpl-refresh/backend/.env.example /opt/fpl-refresh/.env
sudo -u fpl nano /opt/fpl-refresh/.env
```

**Required:**

| Variable | Where to get it |
|----------|------------------|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_KEY` | Supabase Dashboard → Settings → API → anon public key |
| `SUPABASE_SERVICE_KEY` | Supabase Dashboard → Settings → API → service_role key (keep secret) |

**Recommended for production:** set `ENVIRONMENT=production`.  
The rest of the defaults in `.env.example` are fine unless you need to change intervals or DB URL.

Save and exit (Ctrl+O, Enter, Ctrl+X in nano).

---

## 8. Install and start the systemd service

```bash
sudo cp /opt/fpl-refresh/backend/systemd/fpl-refresh.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable fpl-refresh.service
sudo systemctl start fpl-refresh.service
```

---

## 9. Verify it’s running

```bash
sudo systemctl status fpl-refresh.service
```

You should see `active (running)`. To follow logs:

```bash
sudo journalctl -u fpl-refresh.service -f
```

(Ctrl+C to stop following.)

---

## 10. Deploy future updates

After you push changes to `main`, on the droplet run:

```bash
sudo bash /opt/fpl-refresh/backend/scripts/deploy.sh
```

Or from your laptop (replace `YOUR_DROPLET_IP`):

```bash
ssh root@YOUR_DROPLET_IP 'sudo bash /opt/fpl-refresh/backend/scripts/deploy.sh'
```

---

## Troubleshooting

- **Service won’t start:**  
  `sudo journalctl -u fpl-refresh.service -n 50`  
  Check for Python errors or missing env vars (especially Supabase keys).

- **Permission denied on git clone:**  
  If the repo is private, clone as root (with your SSH key), then:  
  `sudo chown -R fpl:fpl /opt/fpl-refresh`

- **Import errors:**  
  Ensure you installed deps into the venv:  
  `sudo -u fpl /opt/fpl-refresh/venv/bin/pip install -r /opt/fpl-refresh/backend/requirements.txt`

- **Supabase/DB errors:**  
  Confirm `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SERVICE_KEY` in `/opt/fpl-refresh/.env` match your Supabase project.
