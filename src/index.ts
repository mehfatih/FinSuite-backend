import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import { prisma } from "./config/database";
import { globalRateLimiter } from "./middleware/rateLimiter";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

// v1
import authRoutes         from "./routes/auth";
import dashboardRoutes    from "./routes/dashboard";
import invoiceRoutes      from "./routes/invoices";
import customerRoutes     from "./routes/customers";
import dealRoutes         from "./routes/deals";
import taskRoutes         from "./routes/tasks";
import aiRoutes           from "./routes/ai";
import adminRoutes        from "./routes/admin/index";
import profileRoutes      from "./routes/profile";
import notificationRoutes from "./routes/notifications";
import paymentRoutes      from "./routes/payments";
// v2
import eFaturaRoutes       from "./routes/efatura";
import aiAssistantRoutes   from "./routes/aiAssistant";
import muhasebeciRoutes    from "./routes/muhasebeci";
import factoringRoutes     from "./routes/factoring";
import customerScoreRoutes from "./routes/customerScore";
// v3
import stockRoutes         from "./routes/stock";
import installmentRoutes   from "./routes/installments";
import checkRoutes         from "./routes/checks";
import whatsappRoutes      from "./routes/whatsapp";
import sprint3Routes      from "./routes/sprint3";
import banksRoutes         from "./routes/banks";
import aiCfoVoiceRoutes from "./routes/aiCfoVoice";
import cashCrisisRoutes    from "./routes/cashCrisis";
import trendyolRoutes      from "./routes/trendyol";
import personnelRoutes     from "./routes/personnel";
import publicProfileRoutes from "./routes/publicProfile";
import recurringRoutes     from "./routes/recurring";
import marketplaceRoutes   from "./routes/marketplace";
import taxCalendarRoutes   from "./routes/taxCalendar";
import benchmarkRoutes     from "./routes/benchmark";
import cronRoutes 	   from "./routes/cronRoutes";
import plansRoutes from "./routes/plans";
import eIrsaliyeRoutes from "./routes/eIrsaliye";
import receiptScansRoutes from "./routes/receiptScans";
import { publicProfileController } from "./controllers/publicProfileController";
// v4
import invoicePdfRoutes from './routes/invoicePdfRoutes';
import otpRoutes from './routes/otpRoutes';
import teamRoutes from './routes/teamRoutes';
import campaignRoutes from './routes/campaignRoutes';
import publicAiDemoRoutes from './routes/publicAiDemo';
// Phase 13 — Trust, Migration & Support
import supportRoutes from './routes/support';
import migrationRoutes, { exportsRouter } from './routes/migration';
import securityRoutes from './routes/security';
import { auditLogger } from './middleware/auditLogger';
// Phase 14 — Admin Operations Center
import adminAuthRoutes from './routes/admin/auth';
// Phase 15 — Customer Dashboard V2 preferences
import customerDashboardPrefsRoutes from './routes/customer/dashboardPrefs';
// Phase 15 — Customer Cmd+K AI intent
import customerCmdkRoutes from './routes/customer/cmdk';
// Sprint D-1 — Insight history + status
import customerInsightsRoutes from './routes/customer/insights';
// Sprint D-2 — PDF export (insight, daily-brief, range-report)
import customerPdfRoutes      from './routes/customer/pdf';
// Sprint D-3 — Sharing recipients + share email/WhatsApp + history
import customerRecipientsRoutes from './routes/customer/recipients';
import customerSharingRoutes    from './routes/customer/sharing';
// Sprint D-3 — Public PDF share endpoint (no auth; JWT-signed token)
import publicShareRoutes        from './routes/publicShare';
// Sprint D-4 — Notifications V2 + preferences
import customerNotificationsV2Routes from './routes/customer/notificationsV2';
import customerPreferencesRoutes     from './routes/customer/preferences';
// Sprint D-4 — Web Push subscription endpoints
import customerWebPushRoutes         from './routes/customer/webPush';
// Sprint D-4 — Resend email webhook (deliveredAt / openedAt for D-3 shares)
import resendWebhookRoutes           from './routes/webhooks/resend';
// Sprint D-5 — public morning-brief unsubscribe (signed-token-gated)
import morningBriefUnsubscribeRoutes from './routes/morningBriefUnsubscribe';
// Sprint D-6 — public weekly-report unsubscribe (signed-token-gated)
import weeklyReportUnsubscribeRoutes from './routes/weeklyReportUnsubscribe';
// Sprint D-5 — customer-side morning brief CRUD + test send + stats
import customerMorningBriefRoutes    from './routes/customer/morningBrief';
// Sprint D-6 — customer-side weekly report CRUD + viewer + subscription
import customerWeeklyReportRoutes    from './routes/customer/weeklyReport';
// Sprint D-7 — customer-side public share link CRUD
import customerPublicShareLinksRoutes from './routes/customer/publicShareLinks';
// Sprint D-7 — public HTML / OG image / view-tracking endpoints
import { sharePageRouter, ogImageRouter, trackRouter } from './routes/publicShareLink';
// Sprint D-4 — register Web Push channel into the notification engine
import { configureWebPush, webPushChannel } from './services/notifications/channels/webPushChannel';
import { registerChannel }                  from './services/notifications/engine';

const app = express();

app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(globalRateLimiter);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "ok", service: "zyrix-finsuite-backend", version: "3.0.0", environment: env.nodeEnv, timestamp: new Date().toISOString() } });
});

// v1
app.use("/api/auth",          authRoutes);
app.use("/api/dashboard",     dashboardRoutes);
app.use("/api/invoices",      invoiceRoutes);
app.use("/api/customers",     customerRoutes);
app.use("/api/deals",         dealRoutes);
app.use("/api/tasks",         taskRoutes);
app.use("/api/ai",            aiRoutes);
app.use("/api/public-ai-demo", publicAiDemoRoutes);
// IMPORTANT: mount the more specific /api/admin/auth BEFORE the generic /api/admin
// so the public login/2FA endpoints aren't intercepted by adminRoutes' authenticateAdmin middleware.
app.use('/api/admin/auth',    adminAuthRoutes);
app.use("/api/admin",         adminRoutes);
// Phase 15 — Customer Dashboard V2 preferences + Cmd+K
app.use('/api/customer/dashboard', customerDashboardPrefsRoutes);
app.use('/api/customer/insights',  customerInsightsRoutes);
app.use('/api/customer/pdf',       customerPdfRoutes);
app.use('/api/customer/recipients', customerRecipientsRoutes);
// Sprint D-3 — share endpoints share base path with sharing controller
app.use('/api/customer',           customerSharingRoutes);
// Public, no auth — JWT in :token is the credential
app.use('/share',                  publicShareRoutes);
// Sprint D-4 — V2 notification feed + preferences
app.use('/api/customer/notifications', customerNotificationsV2Routes);
app.use('/api/customer/preferences',   customerPreferencesRoutes);
app.use('/api/customer/web-push',      customerWebPushRoutes);
// Sprint D-4 — public Resend webhook (HMAC-verified inside; no auth)
app.use('/api/webhooks',               resendWebhookRoutes);
// Sprint D-5 — public unsubscribe (signed JWT in token query/body; no auth)
app.use('/api/morning-brief/unsubscribe', morningBriefUnsubscribeRoutes);
// Sprint D-6 — public weekly-report unsubscribe (distinct token namespace)
app.use('/api/weekly-report/unsubscribe', weeklyReportUnsubscribeRoutes);
// Sprint D-5 — authenticated customer subscription CRUD
app.use('/api/customer/morning-brief',    customerMorningBriefRoutes);
// Sprint D-6 — authenticated customer weekly-report endpoints
app.use('/api/customer/weekly-report',    customerWeeklyReportRoutes);
// Sprint D-7 — authenticated customer public-share-link CRUD
app.use('/api/customer/share-links',      customerPublicShareLinksRoutes);
// Sprint D-7 — public, no-auth share endpoints (slug IS the credential)
app.use('/share',                          sharePageRouter);
app.use('/og',                             ogImageRouter);
app.use('/api/public',                     trackRouter);
app.use('/api/customer',           customerCmdkRoutes);

// Sprint D-4 — register the Web Push channel into the engine if VAPID
// env vars are present. Safe no-op when they're absent.
if (configureWebPush()) {
  registerChannel(webPushChannel);
}
app.use("/api/profile",       profileRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments",      paymentRoutes);
// v2
app.use("/api/efatura",        eFaturaRoutes);
app.use("/api/ai-assistant",   aiAssistantRoutes);
app.use("/api/muhasebeci",     muhasebeciRoutes);
app.use("/api/factoring",      factoringRoutes);
app.use("/api/customer-score", customerScoreRoutes);
// v3
app.use("/api/stock",          stockRoutes);
app.use("/api/installments",   installmentRoutes);
app.use("/api/checks",         checkRoutes);
app.use("/api/whatsapp",       whatsappRoutes);
app.use("/api/sprint3",        sprint3Routes);
app.use("/api/banks",          banksRoutes);
app.use("/api/ai-cfo", aiCfoVoiceRoutes);
app.use("/api/cash-crisis",    cashCrisisRoutes);
app.use("/api/trendyol",       trendyolRoutes);
app.use("/api/personnel",      personnelRoutes);
app.use("/api/profile-page",   publicProfileRoutes);
app.use("/api/recurring",      recurringRoutes);
app.use("/api/marketplace",    marketplaceRoutes);
app.use("/api/tax-calendar",   taxCalendarRoutes);
app.use("/api/benchmark",      benchmarkRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/eirsaliye", eIrsaliyeRoutes);
app.use("/api/receipts", receiptScansRoutes);
app.use('/api/cron',           cronRoutes);
// v4
app.use('/api/invoices',   invoicePdfRoutes);  // يضيف /:id/pdf على الـ invoices الموجود
app.use('/api/auth/otp',   otpRoutes);
app.use('/api/team',       teamRoutes);
app.use('/api/campaigns',  campaignRoutes);
// Phase 13 — Trust, Migration & Support
app.use(auditLogger);
app.use('/api/support',    supportRoutes);
app.use('/api/migration',  migrationRoutes);
app.use('/api/exports',    exportsRouter);
app.use('/api/security',   securityRoutes);
// Phase 14 — Admin Operations Center (mounted earlier, before /api/admin)
// Public
app.get("/p/:slug", publicProfileController.viewPublic);

app.use(notFoundHandler);
app.use(errorHandler);

async function bootstrap(): Promise<void> {
  app.listen(env.port, () => {
    console.log(`\n🚀 Zyrix FinSuite v3.8 — port ${env.port}`);
    console.log(`✨ 24 features | 56 routes active\n`);
  });
  try { await prisma.$connect(); console.log("✅ Database connected"); }
  catch (err) { console.error("❌ Database error:", err); }
}

process.on("SIGINT",  async () => { await prisma.$disconnect(); process.exit(0); });
process.on("SIGTERM", async () => { await prisma.$disconnect(); process.exit(0); });
bootstrap();
