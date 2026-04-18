// ================================================================
// Zyrix FinSuite — E-Fatura Controller
// GİB (Gelir İdaresi Başkanlığı) E-Fatura & E-Arşiv entegrasyonu
// ================================================================

import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── GİB XML Builder ──────────────────────────────────────────
// Gerçek entegrasyonda GİB API'sine gönderilir.
// Şimdilik sandbox modunda çalışır — keys eklenince aktifleşir.
function buildEFaturaXML(invoice: any, efatura: any, merchant: any): string {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().split(" ")[0];
  const gibUUID = efatura.gibUUID || `${merchant.merchantId}-${Date.now()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>${efatura.faturaNo}</cbc:ID>
  <cbc:UUID>${gibUUID}</cbc:UUID>
  <cbc:IssueDate>${dateStr}</cbc:IssueDate>
  <cbc:IssueTime>${timeStr}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${efatura.faturaType}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency || "TRY"}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${merchant.businessName || merchant.name}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${efatura.buyerVkn || ""}</cbc:CompanyID>
      </cac:PartyTaxScheme>
      <cac:PartyName>
        <cbc:Name>${efatura.buyerTitle || invoice.customerName}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency || "TRY"}">${invoice.subtotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency || "TRY"}">${invoice.subtotal}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency || "TRY"}">${invoice.total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency || "TRY"}">${invoice.total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
}

// ── GİB Sandbox Sender ───────────────────────────────────────
// Gerçek API entegrasyonu: GİB_API_URL + GİB_USERNAME + GİB_PASSWORD
async function sendToGIB(xmlContent: string, faturaNo: string): Promise<{
  success: boolean;
  gibUUID?: string;
  gibResponse?: any;
  error?: string;
}> {
  const gibUrl = process.env.GIB_API_URL;
  const gibUser = process.env.GIB_USERNAME;
  const gibPass = process.env.GIB_PASSWORD;

  // Sandbox modu — GİB credentials yoksa simüle et
  if (!gibUrl || !gibUser || !gibPass) {
    console.log(`[E-Fatura] Sandbox mode — GİB credentials not set. Simulating send for: ${faturaNo}`);
    return {
      success: true,
      gibUUID: `GIB-SANDBOX-${Date.now()}`,
      gibResponse: { status: "SANDBOX", message: "GİB credentials eklenince gerçek gönderim yapılır." },
    };
  }

  try {
    const response = await fetch(`${gibUrl}/efatura/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        "Authorization": `Basic ${Buffer.from(`${gibUser}:${gibPass}`).toString("base64")}`,
      },
      body: xmlContent,
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `GİB HTTP ${response.status}: ${errText}` };
    }

    const result = await response.json();
    return {
      success: true,
      gibUUID: result.uuid || result.UUID,
      gibResponse: result,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export const eFaturaController = {

  // ── GET /api/efatura — tüm e-faturalar
  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { status, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const where: any = { merchantId };
      if (status) where.gibStatus = status;

      const [eFaturalar, total] = await Promise.all([
        prisma.eFatura.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: { createdAt: "desc" },
          include: {
            invoice: {
              select: {
                invoiceNumber: true, customerName: true,
                total: true, currency: true, dueDate: true,
              }
            }
          },
        }),
        prisma.eFatura.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        data: { eFaturalar, total, page: parseInt(page as string), limit: parseInt(limit as string) },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "E-faturalar alınamadı" });
    }
  }),

  // ── POST /api/efatura — yeni e-fatura oluştur ve gönder
  create: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { invoiceId, faturaType = "SATIS", buyerVkn, buyerTitle, buyerAddress } = req.body;

      if (!invoiceId) {
        res.status(400).json({ success: false, error: "invoiceId zorunlu" });
        return;
      }

      // Fatura mevcut mu kontrol et
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, merchantId },
      });
      if (!invoice) {
        res.status(404).json({ success: false, error: "Fatura bulunamadı" });
        return;
      }

      // Daha önce e-fatura oluşturulmuş mu?
      const existing = await prisma.eFatura.findUnique({ where: { invoiceId } });
      if (existing) {
        res.status(409).json({ success: false, error: "Bu fatura için zaten e-fatura oluşturulmuş", data: existing });
        return;
      }

      // E-Fatura numarası oluştur: GIB formatı — AAA YYYY XXXXXXXXX
      const count = await prisma.eFatura.count({ where: { merchantId } });
      const year = new Date().getFullYear();
      const faturaNo = `ZRX${year}${String(count + 1).padStart(9, "0")}`;

      // Merchant bilgilerini al
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { name: true, businessName: true, merchantId: true },
      });

      // E-Fatura kaydını oluştur
      const eFatura = await prisma.eFatura.create({
        data: {
          merchantId, invoiceId, faturaNo, faturaType,
          buyerVkn, buyerTitle, buyerAddress,
          gibStatus: "PENDING",
        },
      });

      // XML oluştur
      const xmlContent = buildEFaturaXML(invoice, eFatura, merchant);

      // GİB'e gönder
      const gibResult = await sendToGIB(xmlContent, faturaNo);

      // Sonuca göre güncelle
      const updated = await prisma.eFatura.update({
        where: { id: eFatura.id },
        data: {
          gibStatus: gibResult.success ? "SENT" : "REJECTED",
          gibUUID: gibResult.gibUUID,
          gibResponse: gibResult.gibResponse || { error: gibResult.error },
          xmlContent,
          sentAt: gibResult.success ? new Date() : null,
          rejectionReason: gibResult.success ? null : gibResult.error,
        },
      });

      res.status(201).json({
        success: true,
        data: updated,
        message: gibResult.success
          ? `E-Fatura GİB'e iletildi. Fatura No: ${faturaNo}`
          : `E-Fatura oluşturuldu ancak GİB gönderimi başarısız: ${gibResult.error}`,
      });
    } catch (err) {
      console.error("[E-Fatura create]", err);
      res.status(500).json({ success: false, error: "E-fatura oluşturulamadı" });
    }
  }),

  // ── GET /api/efatura/:id — tekil e-fatura detayı
  getById: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const eFatura = await prisma.eFatura.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        include: { invoice: true },
      });
      if (!eFatura) {
        res.status(404).json({ success: false, error: "E-Fatura bulunamadı" });
        return;
      }
      res.status(200).json({ success: true, data: eFatura });
    } catch (err) {
      res.status(500).json({ success: false, error: "E-fatura alınamadı" });
    }
  }),

  // ── POST /api/efatura/:id/cancel — e-fatura iptal
  cancel: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const eFatura = await prisma.eFatura.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
      });
      if (!eFatura) {
        res.status(404).json({ success: false, error: "E-Fatura bulunamadı" });
        return;
      }
      if (eFatura.gibStatus === "CANCELLED") {
        res.status(400).json({ success: false, error: "E-Fatura zaten iptal edilmiş" });
        return;
      }

      const updated = await prisma.eFatura.update({
        where: { id: req.params.id },
        data: { gibStatus: "CANCELLED" },
      });
      res.status(200).json({ success: true, data: updated, message: "E-Fatura iptal edildi" });
    } catch (err) {
      res.status(500).json({ success: false, error: "E-fatura iptal edilemedi" });
    }
  }),

  // ── GET /api/efatura/:id/xml — XML içeriğini indir
  downloadXML: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const eFatura = await prisma.eFatura.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
      });
      if (!eFatura || !eFatura.xmlContent) {
        res.status(404).json({ success: false, error: "XML bulunamadı" });
        return;
      }
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename="${eFatura.faturaNo}.xml"`);
      res.send(eFatura.xmlContent);
    } catch (err) {
      res.status(500).json({ success: false, error: "XML indirilemedi" });
    }
  }),

  // ── GET /api/efatura/stats — istatistikler
  stats: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const [total, sent, accepted, rejected, pending] = await Promise.all([
        prisma.eFatura.count({ where: { merchantId } }),
        prisma.eFatura.count({ where: { merchantId, gibStatus: "SENT" } }),
        prisma.eFatura.count({ where: { merchantId, gibStatus: "ACCEPTED" } }),
        prisma.eFatura.count({ where: { merchantId, gibStatus: "REJECTED" } }),
        prisma.eFatura.count({ where: { merchantId, gibStatus: "PENDING" } }),
      ]);
      res.status(200).json({ success: true, data: { total, sent, accepted, rejected, pending } });
    } catch (err) {
      res.status(500).json({ success: false, error: "İstatistikler alınamadı" });
    }
  }),
};