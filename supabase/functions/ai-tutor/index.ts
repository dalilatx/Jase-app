// Supabase Edge Function: the app's AI teacher, "Ms. Bright".
//
// The browser can't hold the Anthropic API key safely, so every AI request
// from the app comes here. This function:
//   1. only answers signed-in parents (the app sends their login token),
//   2. adds the API key, which lives in the function's secrets,
//   3. tells the model it is teaching a child, so replies stay kind,
//      age-appropriate and on-topic,
//   4. caps request size so a bug or misuse can't run up a large bill.
//
// Request body:  { prompt: string, maxTokens?: number, schema?: JSON Schema }
//   schema: when given, the reply is guaranteed to be JSON matching it.
// Response body: { text: string | null, error?: string }
//   error explains failures in plain words, so the app can show grown-ups
//   what to fix (missing key, no credit, reply cut off, ...).

import Anthropic from "npm:@anthropic-ai/sdk@0.131";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const MAX_PROMPT_CHARS = 12000;
const MAX_REPLY_TOKENS = 12000;
const MAX_SCHEMA_CHARS = 10000;

const SYSTEM_PROMPT = `You are Ms. Bright, a warm, patient teacher in a home-learning app used by children from kindergarten through 12th grade. Some students are behind grade level because of interruptions in their schooling.

Always:
- Speak to the student at the grade level given in the request, in clear, simple, encouraging language.
- Teach accurately. If you are unsure of a fact, say so rather than guess.
- Keep content safe and appropriate for children. Never include anything violent, sexual, frightening, or unsafe, and never ask for personal information.
- If a student brings up something unsafe or upsetting, respond kindly and suggest they talk to a parent or trusted adult.
- When the request asks for JSON, reply with only valid JSON in exactly the requested shape, with no extra text or code fences.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Only signed-in parents may use the tutor.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not signed in" }, 401);

  let body: { prompt?: unknown; maxTokens?: unknown; schema?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json({ error: "Missing prompt" }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: "Prompt too long" }, 413);

  const schema = body.schema && typeof body.schema === "object" ? body.schema : null;
  if (schema && JSON.stringify(schema).length > MAX_SCHEMA_CHARS) return json({ error: "Schema too large" }, 413);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI is not set up yet (missing ANTHROPIC_API_KEY secret)" }, 500);
  const client = new Anthropic({ apiKey });

  // The app's maxTokens is sized for the visible answer; leave generous
  // headroom for the model's own thinking, which counts toward the cap.
  // (You only pay for tokens actually used, not the cap.)
  const requested = typeof body.maxTokens === "number" && body.maxTokens > 0 ? body.maxTokens : 700;
  const maxTokens = Math.min(requested * 2 + 2000, MAX_REPLY_TOKENS);

  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: maxTokens,
      // Quick, inexpensive replies: these are short teaching tasks.
      output_config: schema ? { effort: "low", format: { type: "json_schema", schema } } : { effort: "low" },
      // If a safety check declines a harmless school question, retry on
      // Anthropic's recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    };
    const response = await client.beta.messages.create(params);

    if (response.stop_reason === "refusal") return json({ text: null, error: "The AI declined this request" });
    if (response.stop_reason === "max_tokens") return json({ text: null, error: "The AI's reply was cut off before it finished" });
    const text = response.content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { type: string; text?: string }) => block.text ?? "")
      .join("\n")
      .trim();
    return json({ text: text || null });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic rejected the API key");
      return json({ error: "AI key is invalid" }, 500);
    } else if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "AI is busy, try again in a moment" }, 429);
    } else if (err instanceof Anthropic.APIError) {
      // Include Anthropic's message (for example a low credit balance) so a
      // grown-up can see what to fix; it never contains the key.
      console.error(`Anthropic API error ${err.status}:`, err.message);
      return json({ error: `AI request failed (${err.status}): ${err.message}` }, 502);
    }
    console.error("Unexpected error:", err);
    return json({ error: "AI request failed" }, 500);
  }
});
