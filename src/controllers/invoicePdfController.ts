import { Request, Response } from 'express';
import puppeteer from 'puppeteer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const downloadInvoicePdf = async (req: Request, res: Response) => {
  const { id } = req.params;
  const merchant = (req as any).merchant;

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, merchantId: merchant.id },
      include: {
        merchant: true,
        items: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Fatura bulunamadı' });
    }

    const html = buildInvoiceHtml(invoice);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();

    const invoiceNo = invoice.invoiceNumber || invoice.id.slice(0, 8).toUpperCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fatura-${invoiceNo}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  } catch (err) {
    console.error('PDF oluşturma hatası:', err);
    res.status(500).json({ error: 'PDF oluşturulamadı' });
  }
};

function buildInvoiceHtml(invoice: any): string {
  const merchant = invoice.merchant;
  const items = invoice.items || [];

  const issueDate = new Date(invoice.issueDate || invoice.createdAt).toLocaleDateString('tr-TR');
  const dueDate = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('tr-TR')
    : '—';

  const statusMap: Record<string, { label: string; color: string }> = {
    PAID: { label: 'Ödendi', color: '#16a34a' },
    PENDING: { label: 'Bekliyor', color: '#d97706' },
    OVERDUE: { label: 'Gecikmiş', color: '#dc2626' },
    CANCELLED: { label: 'İptal', color: '#6b7280' },
  };
  const status = statusMap[invoice.status] || { label: invoice.status, color: '#6b7280' };

  const itemRows = items
    .map(
      (item: any) => `
      <tr>
        <td class="item-desc">${item.description || item.name || '—'}</td>
        <td class="item-center">${item.quantity}</td>
        <td class="item-center">${item.unit || 'Adet'}</td>
        <td class="item-right">₺${Number(item.unitPrice || item.price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
        <td class="item-center">${item.vatRate ?? 18}%</td>
        <td class="item-right bold">₺${Number(item.total || (item.quantity * (item.unitPrice || item.price || 0))).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
      </tr>`
    )
    .join('');

  const subtotal = Number(invoice.subtotal || invoice.amount || 0);
  const vatAmount = Number(invoice.vatAmount || subtotal * 0.18);
  const total = Number(invoice.total || invoice.amount || subtotal + vatAmount);

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', 'Segoe UI', sans-serif;
    background: #fff;
    color: #1a1a2e;
    font-size: 13px;
  }

  /* ─── HEADER ─── */
  .header {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0ea5e9 100%);
    padding: 36px 48px 32px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .brand { display: flex; flex-direction: column; gap: 6px; }
  .brand-name {
    font-size: 26px;
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.5px;
  }
  .brand-name span { color: #38bdf8; }
  .brand-tagline { font-size: 11px; color: #94a3b8; letter-spacing: 1.5px; text-transform: uppercase; }

  .invoice-badge {
    text-align: right;
  }
  .invoice-badge .label {
    font-size: 11px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }
  .invoice-badge .number {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    margin-top: 4px;
  }
  .status-pill {
    display: inline-block;
    margin-top: 8px;
    padding: 4px 14px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(255,255,255,0.15);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
  }

  /* ─── META STRIP ─── */
  .meta-strip {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 20px 48px;
    display: flex;
    gap: 48px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 3px; }
  .meta-item .meta-label {
    font-size: 10px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .meta-item .meta-value {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
  }

  /* ─── PARTIES ─── */
  .parties {
    padding: 32px 48px;
    display: flex;
    justify-content: space-between;
    gap: 32px;
  }
  .party { flex: 1; }
  .party-header {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 2px solid #0ea5e9;
    display: inline-block;
  }
  .party-name {
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 6px;
  }
  .party-detail {
    font-size: 12px;
    color: #475569;
    line-height: 1.7;
  }

  /* ─── TABLE ─── */
  .table-wrap { padding: 0 48px 32px; }

  table {
    width: 100%;
    border-collapse: collapse;
  }
  thead tr {
    background: #0f172a;
    color: #fff;
  }
  thead th {
    padding: 12px 14px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .th-left { text-align: left; border-radius: 0; }
  .th-center { text-align: center; }
  .th-right { text-align: right; }

  tbody tr { border-bottom: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody tr:hover { background: #f0f9ff; }

  td { padding: 12px 14px; vertical-align: middle; }
  .item-desc { font-weight: 500; color: #0f172a; }
  .item-center { text-align: center; color: #475569; }
  .item-right { text-align: right; color: #475569; }
  .bold { font-weight: 700; color: #0f172a !important; }

  /* ─── TOTALS ─── */
  .totals-wrap {
    padding: 0 48px 32px;
    display: flex;
    justify-content: flex-end;
  }
  .totals-box {
    width: 320px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 10px 20px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 13px;
  }
  .totals-row:last-child { border-bottom: none; }
  .totals-row .t-label { color: #64748b; }
  .totals-row .t-value { font-weight: 600; color: #0f172a; }
  .totals-row.grand {
    background: #0f172a;
  }
  .totals-row.grand .t-label { color: #94a3b8; font-weight: 600; }
  .totals-row.grand .t-value { color: #fff; font-size: 16px; font-weight: 800; }

  /* ─── NOTES ─── */
  .notes {
    padding: 0 48px 32px;
  }
  .notes-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px 20px;
  }
  .notes-title {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .notes-text { font-size: 12px; color: #475569; line-height: 1.6; }

  /* ─── FOOTER ─── */
  .footer {
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    padding: 20px 48px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-brand { font-size: 12px; font-weight: 700; color: #0f172a; }
  .footer-brand span { color: #0ea5e9; }
  .footer-url { font-size: 11px; color: #94a3b8; }
  .footer-legal { font-size: 10px; color: #94a3b8; text-align: right; line-height: 1.6; }

  /* ─── WATERMARK for PAID ─── */
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 80px;
    font-weight: 900;
    color: rgba(22, 163, 74, 0.06);
    letter-spacing: 10px;
    pointer-events: none;
    z-index: 0;
  }
</style>
</head>
<body>

${invoice.status === 'PAID' ? '<div class="watermark">ÖDENDİ</div>' : ''}

<!-- HEADER -->
<div class="header">
  <div class="brand">
    <div class="brand-name">Zyrix <span>FinSuite</span></div>
    <div class="brand-tagline">Finansal Yönetim Platformu</div>
  </div>
  <div class="invoice-badge">
    <div class="label">Fatura No</div>
    <div class="number">#${invoice.invoiceNumber || invoice.id.slice(0, 8).toUpperCase()}</div>
    <div class="status-pill" style="background:${status.color}22; border-color:${status.color}44; color:${status.color}">${status.label}</div>
  </div>
</div>

<!-- META STRIP -->
<div class="meta-strip">
  <div class="meta-item">
    <span class="meta-label">Düzenleme Tarihi</span>
    <span class="meta-value">${issueDate}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Vade Tarihi</span>
    <span class="meta-value">${dueDate}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Para Birimi</span>
    <span class="meta-value">${invoice.currency || 'TRY'}</span>
  </div>
  ${invoice.invoiceType ? `
  <div class="meta-item">
    <span class="meta-label">Fatura Türü</span>
    <span class="meta-value">${invoice.invoiceType}</span>
  </div>` : ''}
</div>

<!-- PARTIES -->
<div class="parties">
  <div class="party">
    <div class="party-header">Düzenleyen</div>
    <div class="party-name">${merchant.companyName || merchant.name || merchant.email}</div>
    <div class="party-detail">
      ${merchant.taxNumber ? `Vergi No: ${merchant.taxNumber}<br>` : ''}
      ${merchant.taxOffice ? `Vergi Dairesi: ${merchant.taxOffice}<br>` : ''}
      ${merchant.address ? `${merchant.address}<br>` : ''}
      ${merchant.phone ? `Tel: ${merchant.phone}<br>` : ''}
      ${merchant.email}
    </div>
  </div>
  <div class="party">
    <div class="party-header">Alıcı</div>
    <div class="party-name">${invoice.customerName || invoice.recipientName || '—'}</div>
    <div class="party-detail">
      ${invoice.customerTaxNumber ? `Vergi No: ${invoice.customerTaxNumber}<br>` : ''}
      ${invoice.customerAddress ? `${invoice.customerAddress}<br>` : ''}
      ${invoice.customerEmail ? invoice.customerEmail : ''}
    </div>
  </div>
</div>

<!-- ITEMS TABLE -->
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th class="th-left" style="width:38%">Açıklama</th>
        <th class="th-center" style="width:8%">Miktar</th>
        <th class="th-center" style="width:8%">Birim</th>
        <th class="th-right" style="width:15%">Birim Fiyat</th>
        <th class="th-center" style="width:8%">KDV</th>
        <th class="th-right" style="width:15%">Toplam</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">Kalem bulunamadı</td></tr>`}
    </tbody>
  </table>
</div>

<!-- TOTALS -->
<div class="totals-wrap">
  <div class="totals-box">
    <div class="totals-row">
      <span class="t-label">Ara Toplam</span>
      <span class="t-value">₺${subtotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
    </div>
    <div class="totals-row">
      <span class="t-label">KDV (%18)</span>
      <span class="t-value">₺${vatAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
    </div>
    ${invoice.discount ? `
    <div class="totals-row">
      <span class="t-label">İndirim</span>
      <span class="t-value" style="color:#dc2626">-₺${Number(invoice.discount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
    </div>` : ''}
    <div class="totals-row grand">
      <span class="t-label">GENEL TOPLAM</span>
      <span class="t-value">₺${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
    </div>
  </div>
</div>

${invoice.notes ? `
<!-- NOTES -->
<div class="notes">
  <div class="notes-box">
    <div class="notes-title">Notlar</div>
    <div class="notes-text">${invoice.notes}</div>
  </div>
</div>` : ''}

<!-- FOOTER -->
<div class="footer">
  <div>
    <div class="footer-brand">Zyrix <span>FinSuite</span></div>
    <div class="footer-url">finsuite.zyrix.co</div>
  </div>
  <div class="footer-legal">
    Bu belge Zyrix FinSuite tarafından otomatik olarak oluşturulmuştur.<br>
    Elektronik olarak düzenlenmiş olup imza gerekmez.
  </div>
</div>

</body>
</html>`;
}