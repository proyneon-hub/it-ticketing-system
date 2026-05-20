# Deployment Guide for Pramit

This project is prepared for:

- GitHub owner: `proyneon-hub`
- Suggested repo: `it-ticketing-system`
- Vercel account/team path: `pramits-projects-ce654619`
- Database: MongoDB Atlas using `MONGODB_URI`

## What is already done

- Full-stack source code is included.
- Git repository is initialized locally.
- `origin` is set to:

```bash
https://github.com/proyneon-hub/it-ticketing-system.git
```

- Vercel config is included in `vercel.json`.
- The frontend build command is `npm run build`.
- The production output folder is `dist`.
- Express API routes are served through the root `/api` directory.

## Step 1: Create the GitHub repository

Go to GitHub and create a new empty repository named:

```text
it-ticketing-system
```

Use this owner/account:

```text
proyneon-hub
```

Important: create it empty. Do not add a README, `.gitignore`, or license from GitHub, because this project already includes those files.

## Step 2: Push the code to GitHub

After unzipping the project, open a terminal inside the `it-ticketing-system` folder and run:

```bash
git branch -M main
git remote set-url origin https://github.com/proyneon-hub/it-ticketing-system.git
git push -u origin main
```

If Git asks you to sign in, sign in with your GitHub account. If GitHub rejects password login, use GitHub Desktop, GitHub CLI, or a personal access token.

### Alternative using GitHub CLI

If you have GitHub CLI installed:

```bash
gh auth login
gh repo create proyneon-hub/it-ticketing-system --public --source=. --remote=origin --push
```

## Step 3: Set up MongoDB Atlas

Create a MongoDB Atlas cluster and get a connection string like:

```text
mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/it_ticketing?retryWrites=true&w=majority
```

Save this value. You will need it as `MONGODB_URI`.

## Step 4: Deploy on Vercel from GitHub

1. Go to Vercel.
2. Choose **Add New Project**.
3. Import `proyneon-hub/it-ticketing-system`.
4. Use these project settings:

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

5. Add this environment variable:

```text
MONGODB_URI=your_mongodb_atlas_connection_string
```

6. Deploy.

## Step 5: Deploy using Vercel CLI instead

From inside the project folder:

```bash
npm install
npm run build
npm install -g vercel
vercel login
vercel
vercel env add MONGODB_URI
vercel --prod
```

When Vercel asks for the scope/team, choose:

```text
pramits-projects-ce654619
```

When Vercel asks for the project name, use:

```text
it-ticketing-system
```

## Step 6: Verify after deployment

Open your deployed site and test:

```text
https://YOUR-VERCEL-APP.vercel.app/api/health
```

You should see:

```json
{
  "ok": true,
  "service": "it-ticketing-system"
}
```

Then open the main app URL and create a sample ticket.

## Common issues

### API works locally but not on Vercel

Check that `MONGODB_URI` is added in Vercel Project Settings under Environment Variables, then redeploy.

### MongoDB connection error

In MongoDB Atlas, make sure:

- The database user exists.
- The password in the URI is correct.
- Network access allows the deployment. For simple portfolio testing, many developers temporarily allow access from anywhere, but restrict it later for security.

### Git push says repository not found

Create the empty repo first at GitHub, then run the push command again.
