// ================================================================
// Sprint D-9 — `/zyrix` slash command router.
//
// Subcommands (V1):
//   /zyrix today    — today's morning brief summary
//   /zyrix mrr      — current MRR + month-over-month trend
//   /zyrix runway   — current cash runway days
//   /zyrix balance  — current cash balance
//   /zyrix overdue  — overdue receivables
//   /zyrix help     — usage help
//
// Reads `KPI_COMPUTATIONS` (D-8 registry, no edits — protected file).
// Returns ephemeral Block Kit replies; never posts to the channel
// unless user explicitly types `/zyrix today public` (V2 — out of scope).
//
// Slack's 3-second reply window: every handler is a single Prisma
// query plus formatting. No external API calls.
// ================================================================
import { PrismaClient } from "@prisma/client";
import { KPI_COMPUTATIONS } from "../../customer/kpiComputations";
import {
  renderKpiReplyAsBlocks,
  Locale,
  SlackBlock
} from "./blockRenderer";

export interface SlashCommandReply {
  response_type: "ephemeral" | "in_channel";
  text:          string;
  blocks?:       SlackBlock[];
}

export interface RouteSlashCommandArgs {
  text:        string;          // "today" | "mrr" | "runway" | "help" | …
  merchantId:  string;
  locale:      Locale;
  prisma:      PrismaClient;
  appBaseUrl:  string;
  currency?:   string;          // 'TRY' | 'USD' | 'SAR' | …
}

const HELP_LINES: Record<Locale, string[]> = {
  tr: [
    "*Zyrix komutları*",
    "`/zyrix today` — bugünkü brifing",
    "`/zyrix mrr` — aylık tekrarlayan gelir",
    "`/zyrix runway` — nakit pisti (gün)",
    "`/zyrix balance` — nakit bakiyesi",
    "`/zyrix overdue` — vadesi geçmiş alacaklar",
    "`/zyrix help` — bu yardım"
  ],
  en: [
    "*Zyrix commands*",
    "`/zyrix today` — today's brief",
    "`/zyrix mrr` — monthly recurring revenue",
    "`/zyrix runway` — cash runway (days)",
    "`/zyrix balance` — cash balance",
    "`/zyrix overdue` — overdue receivables",
    "`/zyrix help` — this help"
  ],
  ar: [
    "*أوامر Zyrix*",
    "`/zyrix today` — موجز اليوم",
    "`/zyrix mrr` — الإيراد الشهري المتكرر",
    "`/zyrix runway` — مدى السيولة (أيام)",
    "`/zyrix balance` — رصيد النقد",
    "`/zyrix overdue` — الذمم المتأخرة",
    "`/zyrix help` — هذه المساعدة"
  ]
};

const TITLES: Record<string, Record<Locale, string>> = {
  mrr: {
    tr: "Aylık Tekrarlayan Gelir (MRR)",
    en: "Monthly Recurring Revenue",
    ar: "الإيراد الشهري المتكرر"
  },
  cash_runway: {
    tr: "Nakit Pisti",
    en: "Cash Runway",
    ar: "مدى السيولة"
  },
  cash_balance: {
    tr: "Nakit Bakiyesi",
    en: "Cash Balance",
    ar: "رصيد النقد"
  },
  overdue_receivables: {
    tr: "Vadesi Geçmiş Alacaklar",
    en: "Overdue Receivables",
    ar: "الذمم المتأخرة"
  }
};

const TREND_LINE: Record<Locale, (pct: number) => string> = {
  tr: (p) => p === 0 ? "Önceki döneme göre değişim yok" : `Önceki döneme göre %${p > 0 ? "+" : ""}${p.toFixed(1)}`,
  en: (p) => p === 0 ? "No change vs prior period" : `${p > 0 ? "+" : ""}${p.toFixed(1)}% vs prior period`,
  ar: (p) => p === 0 ? "لا تغيير مقابل الفترة السابقة" : `${p > 0 ? "+" : ""}${p.toFixed(1)}٪ مقابل الفترة السابقة`
};

const NOT_AVAILABLE: Record<Locale, string> = {
  tr: "Veri yok",
  en: "Not available",
  ar: "غير متاح"
};

const UNKNOWN_CMD: Record<Locale, string> = {
  tr: "Bilinmeyen komut. `/zyrix help` ile kullanılabilir komutları gör.",
  en: "Unknown command. Run `/zyrix help` to see available commands.",
  ar: "أمر غير معروف. شغّل `/zyrix help` لرؤية الأوامر المتاحة."
};

const TODAY_FALLBACK: Record<Locale, string> = {
  tr: "Bugünkü brifing henüz hazır değil. Kısa süre içinde tekrar dene.",
  en: "Today's brief is not ready yet. Try again in a moment.",
  ar: "موجز اليوم ليس جاهزًا بعد. حاول مرة أخرى خلال لحظات."
};

// ─── Helpers ─────────────────────────────────────────────────

function formatCurrency(value: number | null, currency: string, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return NOT_AVAILABLE[locale];
  const intlLocale = locale === "ar" ? "ar-SA" : locale === "en" ? "en-US" : "tr-TR";
  try {
    return new Intl.NumberFormat(intlLocale, {
      style:                 "currency",
      currency:              currency || "TRY",
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `${value.toLocaleString(intlLocale)}`;
  }
}

function formatDays(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return NOT_AVAILABLE[locale];
  const rounded = Math.round(value);
  if (locale === "ar") return `${rounded} يوم`;
  if (locale === "en") return `${rounded} days`;
  return `${rounded} gün`;
}

function ephemeralText(text: string): SlashCommandReply {
  return { response_type: "ephemeral", text };
}

function ephemeralMrkdwn(text: string): SlashCommandReply {
  return {
    response_type: "ephemeral",
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }]
  };
}

// ─── Subcommand handlers ─────────────────────────────────────

async function handleKpiCommand(args: {
  registryKey: "mrr" | "cash_runway" | "cash_balance" | "overdue_receivables";
  formatAs:    "currency" | "days";
  ctaPath:     string;
  cmdArgs:     RouteSlashCommandArgs;
}): Promise<SlashCommandReply> {
  const { registryKey, formatAs, ctaPath, cmdArgs } = args;
  const fn = KPI_COMPUTATIONS[registryKey];
  if (!fn) {
    return ephemeralText(NOT_AVAILABLE[cmdArgs.locale]);
  }
  const result = await fn(cmdArgs.merchantId, cmdArgs.prisma);
  const title  = TITLES[registryKey][cmdArgs.locale];

  const primary = formatAs === "currency"
    ? formatCurrency(result.value, cmdArgs.currency || "TRY", cmdArgs.locale)
    : formatDays(result.value, cmdArgs.locale);

  const secondary = result.value === null ? undefined : TREND_LINE[cmdArgs.locale](Number(result.trend) || 0);

  const { text, blocks } = renderKpiReplyAsBlocks({
    locale:        cmdArgs.locale,
    title,
    primaryValue:  primary,
    secondaryLine: secondary,
    appBaseUrl:    cmdArgs.appBaseUrl,
    ctaPath
  });
  return { response_type: "ephemeral", text, blocks };
}

interface BriefCardLite { title?: unknown; body?: unknown }
function pickCardTitle(card: unknown): string | null {
  if (!card || typeof card !== "object") return null;
  const c = card as BriefCardLite;
  const t = typeof c.title === "string" ? c.title.trim() : "";
  return t.length > 0 ? t : null;
}

async function handleToday(cmdArgs: RouteSlashCommandArgs): Promise<SlashCommandReply> {
  // Pulls today's CustomerDailyBrief if one was generated; otherwise
  // returns a "not ready yet" fallback. Reads only — does not trigger
  // brief generation (cron does that).
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const brief = await cmdArgs.prisma.customerDailyBrief.findUnique({
    where: { customerUserId_briefDate: { customerUserId: cmdArgs.merchantId, briefDate: today } }
  });

  if (!brief) {
    return ephemeralText(TODAY_FALLBACK[cmdArgs.locale]);
  }

  const title = cmdArgs.locale === "tr" ? "Bugün" : cmdArgs.locale === "ar" ? "اليوم" : "Today";
  const labels = {
    tr: { CRITICAL: "🔴 Kritik", ATTENTION: "🟠 Dikkat", OPPORTUNITY: "🟢 Fırsat", none: "Bugün için yeni öne çıkan yok." },
    en: { CRITICAL: "🔴 Critical", ATTENTION: "🟠 Attention", OPPORTUNITY: "🟢 Opportunity", none: "Nothing new highlighted for today." },
    ar: { CRITICAL: "🔴 حرج", ATTENTION: "🟠 انتباه", OPPORTUNITY: "🟢 فرصة", none: "لا جديد بارز اليوم." }
  }[cmdArgs.locale];

  const lines: string[] = [];
  const critical    = pickCardTitle(brief.criticalCard);
  const attention   = pickCardTitle(brief.attentionCard);
  const opportunity = pickCardTitle(brief.opportunityCard);
  if (critical)    lines.push(`*${labels.CRITICAL}* — ${critical}`);
  if (attention)   lines.push(`*${labels.ATTENTION}* — ${attention}`);
  if (opportunity) lines.push(`*${labels.OPPORTUNITY}* — ${opportunity}`);
  const summary = lines.length > 0 ? lines.join("\n") : labels.none;

  const { text, blocks } = renderKpiReplyAsBlocks({
    locale:        cmdArgs.locale,
    title,
    primaryValue:  summary,
    appBaseUrl:    cmdArgs.appBaseUrl,
    ctaPath:       "/dashboard"
  });
  return { response_type: "ephemeral", text, blocks };
}

function handleHelp(cmdArgs: RouteSlashCommandArgs): SlashCommandReply {
  return ephemeralMrkdwn(HELP_LINES[cmdArgs.locale].join("\n"));
}

// ─── Public entry point ──────────────────────────────────────

export async function routeSlashCommand(args: RouteSlashCommandArgs): Promise<SlashCommandReply> {
  const cmd = (args.text || "").trim().split(/\s+/)[0]?.toLowerCase() || "help";

  try {
    switch (cmd) {
      case "today":
        return await handleToday(args);
      case "mrr":
        return await handleKpiCommand({
          registryKey: "mrr",
          formatAs:    "currency",
          ctaPath:     "/dashboard?metric=mrr",
          cmdArgs:     args
        });
      case "runway":
        return await handleKpiCommand({
          registryKey: "cash_runway",
          formatAs:    "days",
          ctaPath:     "/dashboard?metric=runway",
          cmdArgs:     args
        });
      case "balance":
      case "cash":
        return await handleKpiCommand({
          registryKey: "cash_balance",
          formatAs:    "currency",
          ctaPath:     "/dashboard?metric=cash",
          cmdArgs:     args
        });
      case "overdue":
        return await handleKpiCommand({
          registryKey: "overdue_receivables",
          formatAs:    "currency",
          ctaPath:     "/insights?category=overdue",
          cmdArgs:     args
        });
      case "help":
      case "":
        return handleHelp(args);
      default:
        return ephemeralText(UNKNOWN_CMD[args.locale]);
    }
  } catch (err: any) {
    console.error("[slack/slashCommand] handler failed:", err?.message || err);
    return ephemeralText(NOT_AVAILABLE[args.locale]);
  }
}
