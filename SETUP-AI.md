# Turning on Ms. Bright (the AI teacher)

The app's AI features (Ms. Bright's lessons, the tutor chat, Smart Practice,
stories, jokes, weekly notes) need an Anthropic API key. The key must never go
in the website code — anyone could copy it from their browser — so it lives in
a small Supabase "Edge Function" that the app calls. This takes about 15 minutes.

## 1. Get an Anthropic API key (and set a spending cap)

1. Go to **console.anthropic.com** and create an account.
2. Open **Billing** and add a small amount of credit (for example $10).
3. Open **Limits** and set a **monthly spend limit** you're comfortable with.
   The API stops at that amount, so there are no surprise bills.
4. Open **API Keys** → **Create Key**. Name it `jase-app` and copy the key
   (it starts with `sk-ant-`). You can only see it once.

## 2. Add the AI teacher function to Supabase

1. Open your project at **supabase.com/dashboard**.
2. In the left menu, open **Edge Functions**.
3. Choose **Deploy a new function** → **Via Editor**.
4. Name it exactly: `ai-tutor`
5. Delete the sample code, then paste in the whole contents of
   [`supabase/functions/ai-tutor/index.ts`](supabase/functions/ai-tutor/index.ts)
   from this repository (on GitHub, open the file and use the copy button).
6. Click **Deploy function**.

## 3. Give the function your key

1. Still in **Edge Functions**, open **Secrets**.
2. Add a secret named exactly `ANTHROPIC_API_KEY` and paste your key as the value.
3. Save.

## 4. Check it works

Open the app, pick a child, go to **Reading → Joke Time**. You should see a joke
within a few seconds instead of "Couldn't reach the tutor".

## If it doesn't work

When a lesson can't be written, the app now shows a **"For grown-ups:"** line
under the error that says exactly what's wrong (for example "the ai-tutor
function isn't in Supabase yet", "the AI key secret is missing", or "out of
credit") and which step below fixes it.

- **Still "Couldn't reach the tutor"**: in Supabase open **Edge Functions →
  ai-tutor → Logs** and look at the newest error.
  - `missing ANTHROPIC_API_KEY` → the secret name is misspelled (step 3).
  - `AI key is invalid` → copy the key again from the Anthropic console.
  - `401` errors before the function runs → open the function's **Details**
    and turn **Verify JWT** off. That's safe: the function checks the
    parent's login itself and refuses anyone who isn't signed in.
- **It worked, then stopped**: you may have hit your monthly spend limit, or
  need to add credit in the Anthropic console.

## What it costs

Each AI reply is short. A typical tutor answer costs well under one cent, and a
generated lesson about one to two cents. Lessons the app has already generated
are saved and reused, so a lesson is only paid for the first time it's opened.
Your spend limit from step 1 is a hard cap.

## Updating the function later

When the app's code changes `supabase/functions/ai-tutor/index.ts`, repeat
step 2 and paste the new code over the old (your secret stays in place).
