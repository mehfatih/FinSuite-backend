// ================================================================
// Sprint D-9 — Minimal Slack Web API client.
//
// Decision §10.B option B1 — raw HTTP via global fetch (Node 18+).
// No @slack/web-api or @slack/bolt dependency. Only the surface
// area D-9 actually uses: oauth.v2.access, chat.postMessage,
// auth.revoke, conversations.list.
//
// Every Slack API method returns { ok: boolean, error?: string, ... }.
// We surface { ok: true, ...payload } or throw a SlackApiError so
// callers don't have to special-case the envelope on every call.
// ================================================================

const SLACK_API = "https://slack.com/api";

export class SlackApiError extends Error {
  readonly method: string;
  readonly slackError: string;
  readonly httpStatus: number;
  constructor(method: string, slackError: string, httpStatus: number) {
    super(`Slack ${method} failed: ${slackError} (HTTP ${httpStatus})`);
    this.method = method;
    this.slackError = slackError;
    this.httpStatus = httpStatus;
  }
}

async function postForm<T = any>(method: string, params: Record<string, string>, bearer?: string): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method:  "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
    },
    body: new URLSearchParams(params).toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!json || typeof json !== "object") {
    throw new SlackApiError(method, "invalid_json", res.status);
  }
  if (!(json as any).ok) {
    throw new SlackApiError(method, String((json as any).error || "unknown_error"), res.status);
  }
  return json as T;
}

async function postJson<T = any>(method: string, body: unknown, bearer: string): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method:  "POST",
    headers: {
      "content-type":  "application/json; charset=utf-8",
      "authorization": `Bearer ${bearer}`
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!json || typeof json !== "object") {
    throw new SlackApiError(method, "invalid_json", res.status);
  }
  if (!(json as any).ok) {
    throw new SlackApiError(method, String((json as any).error || "unknown_error"), res.status);
  }
  return json as T;
}

// ─── Public methods ──────────────────────────────────────────

export interface OAuthAccessResult {
  ok:           true;
  access_token: string;
  token_type:   string;
  scope:        string;
  bot_user_id:  string;
  team:         { id: string; name: string };
  authed_user:  { id: string };
  incoming_webhook?: {
    channel:      string;
    channel_id:   string;
    configuration_url: string;
    url:          string;
  };
}

export function exchangeOAuthCode(args: {
  code:         string;
  clientId:     string;
  clientSecret: string;
  redirectUri:  string;
}): Promise<OAuthAccessResult> {
  return postForm<OAuthAccessResult>("oauth.v2.access", {
    code:          args.code,
    client_id:     args.clientId,
    client_secret: args.clientSecret,
    redirect_uri:  args.redirectUri
  });
}

export interface PostMessageResult {
  ok:      true;
  channel: string;
  ts:      string;
  message?: { text?: string };
}

export function postMessage(args: {
  botToken: string;
  channel:  string;
  text:     string;          // fallback for clients that don't render blocks
  blocks?:  unknown[];
  threadTs?: string;
}): Promise<PostMessageResult> {
  return postJson<PostMessageResult>("chat.postMessage", {
    channel:    args.channel,
    text:       args.text,
    blocks:     args.blocks,
    thread_ts:  args.threadTs
  }, args.botToken);
}

export interface ConversationsListResult {
  ok:       true;
  channels: Array<{
    id:           string;
    name:         string;
    is_archived?: boolean;
    is_private?:  boolean;
    is_member?:   boolean;
  }>;
  response_metadata?: { next_cursor?: string };
}

export function listConversations(args: {
  botToken: string;
  cursor?:  string;
  /** Comma-separated: "public_channel,private_channel" */
  types?:   string;
  limit?:   number;
}): Promise<ConversationsListResult> {
  const params: Record<string, string> = {
    types:           args.types || "public_channel,private_channel",
    exclude_archived: "true",
    limit:           String(args.limit ?? 200)
  };
  if (args.cursor) params.cursor = args.cursor;
  return postForm<ConversationsListResult>("conversations.list", params, args.botToken);
}

export function authRevoke(botToken: string): Promise<{ ok: true; revoked: boolean }> {
  return postForm<{ ok: true; revoked: boolean }>("auth.revoke", {}, botToken);
}

/**
 * Update an interactive message via the supplied response_url. Slack
 * accepts a JSON body { replace_original, blocks, text } and returns
 * 200 OK with no envelope. Used by interactionRouter to "Resolved ✓"
 * the original button payload after a click.
 */
export async function postToResponseUrl(args: {
  responseUrl:    string;
  text:           string;
  blocks?:        unknown[];
  replaceOriginal?: boolean;
  responseType?:  "ephemeral" | "in_channel";
}): Promise<void> {
  await fetch(args.responseUrl, {
    method:  "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      text:             args.text,
      blocks:           args.blocks,
      replace_original: args.replaceOriginal ?? false,
      response_type:    args.responseType ?? "ephemeral"
    })
  });
  // response_url is fire-and-forget per Slack's docs; non-200 is
  // swallowed (caller already replied to the original webhook).
}
