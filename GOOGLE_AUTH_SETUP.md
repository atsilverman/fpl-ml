# Google Authentication Setup Guide

This guide explains how to set up Google OAuth authentication for the FPL Stats Tracker application using Supabase Auth.

## Prerequisites

- A Supabase project (already set up)
- A Google Cloud Platform (GCP) account
- Access to your Supabase project dashboard

## Step 1: Configure Existing Google OAuth Client

You already have a Google OAuth Client ID. You just need to ensure it's configured correctly:

**Your Client ID:** `1013144580568-kqo2k4nb0eo0i18f98sfmhcc9gc51oqe.apps.googleusercontent.com`

1. **Go to Google Cloud Console**
   - Navigate to [Google Cloud Console](https://console.cloud.google.com/)
   - Select your project
   - Go to "APIs & Services" > "Credentials"
   - Find your OAuth 2.0 Client ID: `1013144580568-kqo2k4nb0eo0i18f98sfmhcc9gc51oqe`

2. **Update Authorized Redirect URIs**
   - Click on your OAuth client to edit it
   - Under "Authorized redirect URIs", add:
     - `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback`
     - Replace `YOUR_SUPABASE_PROJECT_REF` with your actual Supabase project reference
     - You can find this in your Supabase project settings under "API" > "Project URL"
   - If you need to add development URLs:
     - `http://localhost:5173/auth/callback` (or your dev port)
   - Click "Save"

3. **Get Your Client Secret**
   - In the same OAuth client settings, you should see the "Client secret"
   - If you don't see it or need to reset it, click "Reset secret" or view it from the credentials list
   - **Save the Client Secret** - you'll need it for Supabase

**Note:** If you need to create a new OAuth client instead:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: "Web application"
   - Add the redirect URI as shown above

## Step 2: Configure Google OAuth in Supabase

1. **Go to Supabase Dashboard**
   - Navigate to your Supabase project dashboard
   - Go to "Authentication" > "Providers"

2. **Enable Google Provider**
   - Find "Google" in the list of providers
   - Toggle it to "Enabled"

3. **Add Google OAuth Credentials**
   - **Client ID (for OAuth)**: `1013144580568-kqo2k4nb0eo0i18f98sfmhcc9gc51oqe.apps.googleusercontent.com`
   - **Client Secret (for OAuth)**: Paste your Google OAuth Client Secret (from Step 1)
   - Click "Save"

4. **Configure Redirect URLs**
   - In Supabase, go to "Authentication" > "URL Configuration"
   - Add your site URL(s):
     - Development: `http://localhost:5173` (or your dev port)
     - Production: `https://your-domain.com` (when deployed)
   - Add redirect URLs:
     - `http://localhost:5173/auth/callback` (development)
     - `https://your-domain.com/auth/callback` (production)

## Step 3: Run Database Migration

The user configurations table needs to be created in your Supabase database:

1. **Apply the Migration**
   - The migration file is located at: `backend/supabase/migrations/012_create_user_configurations.sql`
   - You can apply it via:
     - Supabase Dashboard: Go to "SQL Editor" and run the migration SQL
     - Or use the Supabase CLI: `supabase db push`

2. **Verify the Migration**
   - Go to "Table Editor" in Supabase Dashboard
   - You should see a new table called `user_configurations`
   - Verify that Row Level Security (RLS) is enabled

## Step 4: Environment Variables

Make sure your frontend has the correct Supabase environment variables:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

These should already be set up. You can find them in:
- Supabase Dashboard > "Settings" > "API"

## Step 5: Test the Authentication

1. **Start your development server**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Test Sign In**
   - Click "Sign in with Google" button in the header
   - You should be redirected to Google's OAuth consent screen
   - After authorizing, you'll be redirected back to the app
   - Your user profile should appear in the header

3. **Test Configuration Persistence**
   - Sign in with Google
   - Configure a manager ID and league ID
   - Sign out and sign back in
   - Your configuration should be preserved

## Troubleshooting

### "Redirect URI mismatch" Error
- Ensure the redirect URI in Google Cloud Console exactly matches:
  `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback`
- Check for trailing slashes or typos

### "OAuth client not found" Error
- Verify the Client ID and Client Secret are correctly entered in Supabase
- Make sure there are no extra spaces when copying/pasting

### Configuration Not Saving
- Check that the `user_configurations` table exists
- Verify RLS policies are correctly set up
- Check browser console for any errors
- Verify the user is authenticated (check `supabase.auth.getSession()`)

### Development vs Production URLs
- Make sure to add both development and production URLs to:
  - Google Cloud Console (Authorized JavaScript origins and redirect URIs)
  - Supabase (Site URL and Redirect URLs)

## Security Notes

- Never commit your Google OAuth Client Secret to version control
- The Client Secret is stored securely in Supabase and never exposed to the frontend
- Row Level Security (RLS) ensures users can only access their own configurations
- Supabase handles all OAuth token management securely

## Reference: Defcon Project Setup

If you have a defcon project with similar Google OAuth setup, you can reference:
- The Google Cloud Console OAuth credentials
- The Supabase provider configuration
- The redirect URI patterns

The setup should be identical - just ensure the redirect URIs point to your FPL project's Supabase instance.
