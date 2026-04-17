import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import { prisma } from "./config/database";
import { globalRateLimiter } from "./middleware/rateLimiter";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth";
import dashboardRoutes from "./routes/dashboard";
import invoiceRoutes from "./routes/invoices";
import customerRoutes from "./routes/customers";
import dealRoutes from "./routes/deals";
import taskRoutes from "./routes/tasks";
import aiRoutes from "./routes/ai";
import adminRoutes from "./routes/admin/index";

const app = express();

// ─── Security ─────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(globalRateLimiter);

// ─── Body Parsing ─────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "zyrix-finsuite-backend",
      version: "1.0.0",
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    }
  });
});

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/deals", dealRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin", adminRoutes);

// ─── Error Handlers ───────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  app.listen(env.port, () => {
    console.log(`\n🚀 Zyrix FinSuite Backend running on port ${env.port}`);
    console.log(`📊 Environment: ${env.nodeEnv}`);
    console.log(`🔗 Health: http://localhost:${env.port}/health\n`);
  });

  try {
    await prisma.$connect();
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed:", err);
  }
}

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();
