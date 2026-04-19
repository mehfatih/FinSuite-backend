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
import personnelRoutes     from "./routes/personnel";
import publicProfileRoutes from "./routes/publicProfile";
import recurringRoutes     from "./routes/recurring";
import marketplaceRoutes   from "./routes/marketplace";
import taxCalendarRoutes   from "./routes/taxCalendar";
import benchmarkRoutes     from "./routes/benchmark";
import { publicProfileController } from "./controllers/publicProfileController";

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
app.use("/api/admin",         adminRoutes);
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
app.use("/api/personnel",      personnelRoutes);
app.use("/api/profile-page",   publicProfileRoutes);
app.use("/api/recurring",      recurringRoutes);
app.use("/api/marketplace",    marketplaceRoutes);
app.use("/api/tax-calendar",   taxCalendarRoutes);
app.use("/api/benchmark",      benchmarkRoutes);
// Public
app.get("/p/:slug", publicProfileController.viewPublic);

app.use(notFoundHandler);
app.use(errorHandler);

async function bootstrap(): Promise<void> {
  app.listen(env.port, () => {
    console.log(`\n🚀 Zyrix FinSuite v3.0 — port ${env.port}`);
    console.log(`✨ 15 features | 25 routes active\n`);
  });
  try { await prisma.$connect(); console.log("✅ Database connected"); }
  catch (err) { console.error("❌ Database error:", err); }
}

process.on("SIGINT",  async () => { await prisma.$disconnect(); process.exit(0); });
process.on("SIGTERM", async () => { await prisma.$disconnect(); process.exit(0); });
bootstrap();
