import dotenv from "dotenv";
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000"),
  jwtSecret: process.env.JWT_SECRET || "zyrix-secret",
  jwtAdminSecret: process.env.JWT_ADMIN_SECRET || "zyrix-admin-secret",
  jwtExpiresIn: "7d",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  databaseUrl: process.env.DATABASE_URL || "",
};
