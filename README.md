# LeafFilter Sales Tracker

A mobile-first iPhone web app for tracking LeafFilter leads and sales in the field.

---

## 🚀 One-Time Setup (takes ~5 minutes)

### Step 1 — Create a Supabase Account
1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **"New Project"**
3. Give it a name like `leaffilter-sales`
4. Set a database password (save it somewhere)
5. Choose a region close to you (e.g. US East)
6. Wait ~1 minute for the project to spin up

---

### Step 2 — Run the Database Setup Script
1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **"New query"**
3. Open the `setup.sql` file from this folder
4. Copy all the contents and paste into the SQL editor
5. Click **"Run"** (green button)
6. You should see: `Success. No rows returned`

---

### Step 3 — Get Your API Credentials
1. In Supabase, go to **Settings → API** (gear icon, bottom of sidebar)
2. Copy your **Project URL** — looks like `https://xxxx.supabase.co`
3. Copy your **anon / public key** — the long `eyJ...` string

---

### Step 4 — Connect the App
1. Open `index.html` in Safari on your iPhone (or on any browser)
2. You'll see the connection screen
3. Paste your **Project URL** and **Anon Key**
4. Tap **"Connect & Launch"**

---

### Step 5 — Add to Home Screen (iPhone)
To make it feel like a native app:
1. Open `index.html` in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Name it `LF Sales` → tap **Add**
5. It will appear on your home screen like any app ✅

---

## 📱 How to Use

| Tab | What it does |
|-----|-------------|
| **Dashboard** | Today's stats, this week's stats, top objections chart |
| **Log Lead** | Tap SOLD or NOT SOLD → fill in details → submit |
| **History** | Browse all past leads, filter by Today / Week / Month / All |
| **Settings** | Add, edit, or delete your "Not Sold" reasons |

---

## 💡 Tips

- **Undo**: After logging a lead, tap **UNDO** within 5 seconds if you made a mistake
- **Edit reasons**: Go to Settings anytime to customize the "Not Sold" reason list
- **Close rate**: Calculated as `Sold ÷ Total Leads logged`
- **Revenue**: Pulls from the sale amount you enter on each sold lead

---

## 📁 File Structure

```
Sales Tracker/
  index.html    ← The full app (open this in your browser)
  setup.sql     ← Run this once in Supabase SQL Editor
  README.md     ← This guide
```

---

## 🔒 Security Note

Your Supabase **anon key** is safe to use in a browser — it's designed for client-side use. Your data is protected by your Supabase project's settings. For extra security, you can enable Row Level Security (instructions are commented out in `setup.sql`).

---

## 🔧 Coming Soon

- Sales Calculator (linear footage pricing, commission estimator)

---

*Built with ❤️ for LeafFilter sales reps in the field.*
