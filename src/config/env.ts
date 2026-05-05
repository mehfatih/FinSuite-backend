import dotenv from "dotenv";
dotenv.config();

export const env = {
  nodeEnv:          process.env.NODE_ENV || "development",
  port:             parseInt(process.env.PORT || "3000"),
  jwtSecret:        process.env.JWT_SECRET || "zyrix-secret",
  jwtAdminSecret:   process.env.JWT_ADMIN_SECRET || "zyrix-admin-secret",
  jwtExpiresIn:     "7d",
  geminiApiKey:     process.env.GEMINI_API_KEY || "",
  databaseUrl:      process.env.DATABASE_URL || "",
  resendApiKey:     process.env.RESEND_API_KEY || "",
  iyzicoApiKey:     process.env.IYZICO_API_KEY || "",
  iyzicoSecretKey:  process.env.IYZICO_SECRET_KEY || "",
  iyzicoBaseUrl:    process.env.IYZICO_BASE_URL || "https://sandbox.iyzipay.com",
  // WhatsApp (Meta Cloud API)
  whatsappToken:    process.env.WHATSAPP_TOKEN || "",
  whatsappPhoneId:  process.env.WHATSAPP_PHONE_ID || "",
  whatsappBusinessId: process.env.WHATSAPP_BUSINESS_ID || "",
  // Bank integrations (placeholder - real keys per bank go in DB per merchant)
  bankSandboxMode:  (process.env.BANK_SANDBOX_MODE || "true") === "true",
};