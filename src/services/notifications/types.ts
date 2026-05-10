// ================================================================
// types.ts — shared notification engine types.
// ================================================================

export type NotificationSeverity =
  | "CRITICAL"
  | "ATTENTION"
  | "OPPORTUNITY"
  | "SHARE_EVENT"
  | "SYSTEM";

export type NotificationChannel = "inapp" | "email" | "webpush" | "mobilepush" | "slack" | "teams";

export type IconTone = "cyan" | "violet" | "mint" | "amber" | "crimson";

export type DigestFrequency = "instant" | "hourly" | "daily" | "never";

/** A normalized notification event handed to the engine. */
export interface NotificationEvent {
  merchantId: string;
  severity:   NotificationSeverity;
  /** Tag for analytics + rendering decisions, e.g. "insight_critical", "share_opened" */
  type:       string;
  title:      string;
  body:       string;
  iconTone?:  IconTone;
  ctaLabel?:  string;
  ctaRoute?:  string;
  insightId?: string;
  shareId?:   string;
  /** Caller-provided extra payload; persisted in Notification.data */
  data?:      Record<string, unknown>;
}

/** A persisted notification row, as returned by the in-app channel. */
export interface PersistedNotification {
  id:           string;
  merchantId:   string;
  severity:     NotificationSeverity | null;
  type:         string;
  title:        string;
  body:         string;
  iconTone:     IconTone | null;
  ctaLabel:     string | null;
  ctaRoute:     string | null;
  insightId:    string | null;
  shareId:      string | null;
  data:         Record<string, unknown> | null;
  channelsSent: NotificationChannel[];
  isRead:       boolean;
  archived:     boolean;
  createdAt:    Date;
}

/** Result of a single channel dispatch attempt. */
export interface ChannelResult {
  channel:  NotificationChannel;
  success:  boolean;
  /** Optional opaque per-channel id (Resend message id, web-push 201, etc.) */
  refId?:   string;
  error?:   string;
}

/** Driver contract for any channel. */
export interface ChannelDriver {
  readonly channel: NotificationChannel;
  send(args: {
    event:        NotificationEvent;
    notification: PersistedNotification | null; // present after the in-app channel persists
  }): Promise<ChannelResult>;
}
