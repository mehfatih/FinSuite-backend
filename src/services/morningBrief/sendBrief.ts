// ================================================================
// Sprint D-5 — sendMorningBrief() — placeholder wired in B.4.
//
// B.2 (this commit) ships the scheduler that finds candidates and
// calls this function. To keep the build green and prevent any
// real production sends until generator + template land, this
// returns ok=false with reason "not_yet_wired".
//
// Replaced in B.4 with: generator → template → resend.emails.send →
// MorningBriefSend row creation.
// ================================================================
import type { ScheduleSubscription, ScheduleMerchant } from "./scheduler";

export interface SendBriefResult {
  ok:      boolean;
  sendId?: string;
  reason?: string;
}

export async function sendMorningBrief(args: {
  sub:      ScheduleSubscription;
  merchant: ScheduleMerchant;
}): Promise<SendBriefResult> {
  // Quiet log so a stray production tick doesn't go silent.
  // Removed once B.4 lands the real implementation.
  console.log(
    `[morning-brief/sendBrief] STUB — would send to ${args.merchant.email} (merchant=${args.merchant.id}, variant=${args.sub.variant}); generator + template wire in B.4.`
  );
  return { ok: false, reason: "not_yet_wired" };
}
