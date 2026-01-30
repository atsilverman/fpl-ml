# GitHub Setup & Git Workflow Walkthrough

This guide gets your **fpl-ml** project on GitHub and explains how commits and pushes work.

---

## Part 1: One-time setup

### Step 1: Initialize Git (do this in Terminal)

Open **Terminal** and run:

```bash
cd /Users/silverman/Desktop/fpl-ml
git init
```

That creates a hidden `.git` folder. Git uses it to track every change in your project. Nothing is sent to the internet yet—everything stays on your machine.

### Step 2: Tell Git who you are (if you haven’t already)

```bash
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

Use the same email as your GitHub account so your commits link to your profile.

### Step 3: Create a repo on GitHub

1. Go to [github.com](https://github.com) and sign in.
2. Click the **+** (top right) → **New repository**.
3. **Repository name:** `fpl-ml` (or any name you like).
4. **Description:** optional (e.g. “FPL league & standings app”).
5. Choose **Private** if you don’t want it public.
6. **Do not** check “Add a README” or “Add .gitignore”—you already have a project.
7. Click **Create repository**.

GitHub will show you a page with a URL like:

- **HTTPS:** `https://github.com/YOUR_USERNAME/fpl-ml.git`
- **SSH:** `git@github.com:YOUR_USERNAME/fpl-ml.git`

You’ll use one of these as the “remote” in the next step.

### Step 4: Connect your folder to GitHub

In Terminal (still in your project folder):

```bash
git remote add origin https://github.com/YOUR_USERNAME/fpl-ml.git
```

Replace `YOUR_USERNAME` and `fpl-ml` with your actual GitHub username and repo name.  
If you prefer SSH, use the `git@github.com:...` URL instead.

You only run this once per project. “origin” is just the name Git uses for this GitHub repo.

### Step 5: First commit and push

```bash
git add .
git status
git commit -m "Initial commit: FPL app with backend, frontend, migrations"
git branch -M main
git push -u origin main
```

- **`git add .`** — stages all files (respecting `.gitignore`).
- **`git status`** — shows what will be committed (good to check).
- **`git commit -m "..."`** — saves a snapshot locally with that message.
- **`git branch -M main`** — renames the branch to `main` (GitHub’s default).
- **`git push -u origin main`** — sends your commits to GitHub and sets `main` as the default branch for future pushes.

After this, your code is on GitHub. Refresh the repo page and you’ll see your files.

---

## Part 2: How data gets to GitHub (concepts)

### Local vs remote

- **Local** = your Mac, the folder `fpl-new` and the `.git` folder inside it.
- **Remote** = the copy of the repo on GitHub (e.g. `origin`).

Nothing goes to GitHub until you **push**. Commits live on your machine until you push them.

### The flow in simple terms

```
Your files  →  git add  →  Staging area  →  git commit  →  Local history  →  git push  →  GitHub
```

1. **Working directory** — The actual files you edit (e.g. in Cursor).
2. **Staging area (index)** — A list of changes you’ve chosen to include in the next commit.  
   `git add` moves changes from working directory → staging.
3. **Commit** — A snapshot of what was staged, stored in Git’s history **on your computer**.  
   `git commit` takes the staging area and creates that snapshot.
4. **Push** — Copies your new commits from your computer to GitHub.  
   `git push` sends local commits to the remote (e.g. `origin main`).

So: **commits** are local; **push** is what “sends” them to GitHub.

### Useful commands (day to day)

| What you want              | Command |
|----------------------------|--------|
| See what changed           | `git status` |
| Stage all changes          | `git add .` |
| Stage one file             | `git add path/to/file` |
| Commit with a message      | `git commit -m "Short description"` |
| Send commits to GitHub     | `git push` |
| Get latest from GitHub     | `git pull` |
| See commit history         | `git log --oneline` |

### Example: you fix a bug

```bash
# 1. You edited some files in Cursor. Check what Git sees:
git status

# 2. Stage the changes you want in this “save point”:
git add .

# 3. Create the save point (commit) with a clear message:
git commit -m "Fix league standings refresh when GW is finished"

# 4. Send that commit to GitHub:
git push
```

After step 3, the fix is saved in Git **on your machine**. After step 4, it’s also on GitHub (backup and shareable).

### Don’t push by mistake

- **`.gitignore`** — Files and folders listed here are never added or committed (e.g. `.env`, `node_modules/`, `venv/`). Your project already has a good `.gitignore`.
- **`git status`** — Always run this before `git add` to see what will be committed. If something sensitive appears, add it to `.gitignore` and don’t add that file.

### If you get “rejected” on push

If someone else (or you on another machine) pushed to the same branch first, run:

```bash
git pull
```

That merges their changes into yours. Then run `git push` again.

---

## Part 3: Quick reference

**One-time (per machine):**

- `git init` — Turn current folder into a Git repo.
- `git remote add origin <URL>` — Link this repo to GitHub.

**Every new “save” you want on GitHub:**

1. `git add .` (or specific files)
2. `git commit -m "Describe what you did"`
3. `git push`

**Safety checks:**

- `git status` — Before add/commit.
- `git log --oneline` — See recent commits.

If you hit a specific error message (e.g. “failed to push”, “conflict”), you can look it up or ask again with the exact message and we can fix it step by step.
