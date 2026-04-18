// ================================================================
// Zyrix FinSuite — Personel & SGK Takibi Controller (Feature 10)
// Türkiye 2026 SGK + Gelir Vergisi hesaplama
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Türkiye 2026 Vergi Parametreleri ─────────────────────────
const SGK = {
  employeeRate: 0.14,     // İşçi SGK %14
  employerRate: 0.205,    // İşveren SGK %20.5
  unemploymentEmployee: 0.01,   // İşsizlik işçi %1
  unemploymentEmployer: 0.02,   // İşsizlik işveren %2
  stampTaxRate: 0.00759,  // Damga vergisi %0.759
};

// 2026 Gelir Vergisi dilimleri (TRY/yıl) — yaklaşık
const TAX_BRACKETS = [
  { limit: 158_000,   rate: 0.15 },
  { limit: 330_000,   rate: 0.20 },
  { limit: 800_000,   rate: 0.27 },
  { limit: 4_300_000, rate: 0.35 },
  { limit: Infinity,  rate: 0.40 },
];

function calculateSalary(grossSalary: number, month = 1) {
  const sgkEmployee    = grossSalary * SGK.employeeRate;
  const sgkUnemployee  = grossSalary * SGK.unemploymentEmployee;
  const sgkEmployer    = grossSalary * SGK.employerRate;
  const sgkUnEmployer  = grossSalary * SGK.unemploymentEmployer;
  const taxBase        = grossSalary - sgkEmployee - sgkUnemployee;

  // Kümülatif gelir vergisi (basitleştirilmiş aylık hesap)
  const annualBase     = taxBase * 12;
  let annualTax = 0;
  let prev = 0;
  for (const bracket of TAX_BRACKETS) {
    if (annualBase <= prev) break;
    const taxable = Math.min(annualBase, bracket.limit) - prev;
    annualTax += taxable * bracket.rate;
    prev = bracket.limit;
  }
  const incomeTax = annualTax / 12;
  const stampTax  = grossSalary * SGK.stampTaxRate;
  const netSalary = grossSalary - sgkEmployee - sgkUnemployee - incomeTax - stampTax;
  const totalCost = grossSalary + sgkEmployer + sgkUnEmployer;

  return {
    grossSalary,
    sgkEmployee:  parseFloat(sgkEmployee.toFixed(2)),
    sgkEmployer:  parseFloat(sgkEmployer.toFixed(2)),
    incomeTax:    parseFloat(incomeTax.toFixed(2)),
    stampTax:     parseFloat(stampTax.toFixed(2)),
    netSalary:    parseFloat(netSalary.toFixed(2)),
    totalCost:    parseFloat(totalCost.toFixed(2)),
  };
}

export const personnelController = {

  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status } = req.query;
      const where: any = { merchantId: req.merchant!.id };
      if (status) where.status = status;
      const personnel = await prisma.personnel.findMany({ where, orderBy: { name: "asc" } });
      const totalMonthlyCost = personnel.filter(p => p.status === "ACTIVE").reduce((s, p) => {
        const calc = calculateSalary(Number(p.grossSalary));
        return s + calc.totalCost;
      }, 0);
      res.json({ success: true, data: { personnel, total: personnel.length, totalMonthlyCost: parseFloat(totalMonthlyCost.toFixed(2)) } });
    } catch { res.status(500).json({ success: false, error: "Personel listesi alınamadı" }); }
  }),

  getById: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const person = await prisma.personnel.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        include: { salarySlips: { orderBy: { period: "desc" }, take: 12 } },
      });
      if (!person) return res.status(404).json({ success: false, error: "Personel bulunamadı" });
      res.json({ success: true, data: person });
    } catch { res.status(500).json({ success: false, error: "Personel alınamadı" }); }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, tcKimlik, email, phone, position, department, startDate, grossSalary, sgkNo, ibanNo, notes } = req.body;
      if (!name || !startDate || !grossSalary) return res.status(400).json({ success: false, error: "Ad, başlangıç tarihi ve brüt maaş zorunlu" });
      const person = await prisma.personnel.create({
        data: { merchantId: req.merchant!.id, name, tcKimlik, email, phone, position, department, startDate: new Date(startDate), grossSalary, sgkNo, ibanNo, notes },
      });
      res.status(201).json({ success: true, data: person });
    } catch { res.status(500).json({ success: false, error: "Personel eklenemedi" }); }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await prisma.personnel.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!existing) return res.status(404).json({ success: false, error: "Personel bulunamadı" });
      const updated = await prisma.personnel.update({ where: { id: req.params.id }, data: req.body });
      res.json({ success: true, data: updated });
    } catch { res.status(500).json({ success: false, error: "Güncelleme başarısız" }); }
  }),

  // ── Maaş bordrosu oluştur
  generateSlip: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { period } = req.body; // "2026-04"
      const person = await prisma.personnel.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!person) return res.status(404).json({ success: false, error: "Personel bulunamadı" });
      if (person.status !== "ACTIVE") return res.status(400).json({ success: false, error: "Aktif olmayan personel için bordro oluşturulamaz" });

      const existing = await prisma.salarySlip.findUnique({ where: { personnelId_period: { personnelId: person.id, period } } });
      if (existing) return res.status(409).json({ success: false, error: "Bu dönem için bordro zaten mevcut", data: existing });

      const calc = calculateSalary(Number(person.grossSalary));
      const slip = await prisma.salarySlip.create({
        data: { personnelId: person.id, period, ...calc },
      });
      res.status(201).json({ success: true, data: { slip, breakdown: calc } });
    } catch { res.status(500).json({ success: false, error: "Bordro oluşturulamadı" }); }
  }),

  // ── Tüm aktif personel için bulk bordro
  generateBulk: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { period } = req.body;
      if (!period) return res.status(400).json({ success: false, error: "Dönem zorunlu (örn: 2026-04)" });
      const personnel = await prisma.personnel.findMany({ where: { merchantId: req.merchant!.id, status: "ACTIVE" } });
      let created = 0, skipped = 0;
      for (const person of personnel) {
        const exists = await prisma.salarySlip.findUnique({ where: { personnelId_period: { personnelId: person.id, period } } });
        if (exists) { skipped++; continue; }
        const calc = calculateSalary(Number(person.grossSalary));
        await prisma.salarySlip.create({ data: { personnelId: person.id, period, ...calc } });
        created++;
      }
      res.json({ success: true, data: { created, skipped, total: personnel.length }, message: `${created} bordro oluşturuldu, ${skipped} zaten mevcut` });
    } catch { res.status(500).json({ success: false, error: "Toplu bordro başarısız" }); }
  }),

  // ── Maaş hesaplama (kayıt oluşturmadan)
  calculate: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { grossSalary } = req.body;
      if (!grossSalary || isNaN(Number(grossSalary))) return res.status(400).json({ success: false, error: "Geçerli brüt maaş girin" });
      const calc = calculateSalary(Number(grossSalary));
      res.json({ success: true, data: { ...calc, parameters: { sgkEmployeeRate: "14%", sgkEmployerRate: "20.5%", unemploymentRate: "1% + 2%", stampTaxRate: "0.759%" } } });
    } catch { res.status(500).json({ success: false, error: "Hesaplama başarısız" }); }
  }),
};