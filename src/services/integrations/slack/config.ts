// ================================================================
// Sprint D-9 — Slack integration feature-flag config.
//
// Per Mehmet's deferred-env-vars rule: the 5 Slack env vars
// (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET,
// SLACK_REDIRECT_URI, SLACK_APP_ID) will be added on Railway AFTER
// D-9 + D-10 ship. Until then:
//
//   - server boot must NOT crash
//   - integration endpoints return 503 with a clean message
//   - all other functionality (D-4..D-8) is unaffected
//
// `getSlackConfig()` returns null when not all vars are set; callers
// short-circuit. `isSlackConfigured()` is the boolean cousin used by
// the channel driver registration in src/index.ts.
// ================================================================

export interface SlackConfig {
  clientId:       string;
  clientSecret:   string;
  signingSecret:  string;
  redirectUri:    string;
  appId:          string;
}

export function getSlackConfig(): SlackConfig | null {
  const clientId      = process.env.SLACK_CLIENT_ID;
  const clientSecret  = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const redirectUri   = process.env.SLACK_REDIRECT_URI;
  const appId         = process.env.SLACK_APP_ID;

  if (!clientId || !clientSecret || !signingSecret || !redirectUri || !appId) {
    return null;
  }
  return { clientId, clientSecret, signingSecret, redirectUri, appId };
}

export function isSlackConfigured(): boolean {
  return getSlackConfig() !== null;
}

/** Slack-Bolt scopes requested at install time (decision §10 / discovery §2.2). */
export const SLACK_BOT_SCOPES: string[] = [
  "chat:write",
  "chat:write.public",
  "incoming-webhook",
  "commands",
  "channels:read",
  "groups:read"
];

/** Public OAuth start URL — Slack redirects back to redirectUri with ?code=. */
export function buildAuthorizeUrl(args: {
  clientId:    string;
  redirectUri: string;
  scopes:      string[];
  state:       string;
}): string {
  const u = new URL("https://slack.com/oauth/v2/authorize");
  u.searchParams.set("client_id",    args.clientId);
  u.searchParams.set("scope",        args.scopes.join(","));
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("state",        args.state);
  return u.toString();
}
