import { Resend } from "resend";
import { env } from "../config/env";

const resend = new Resend(env.resendApiKey);

const FROM = "Zyrix FinSuite <noreply@zyrix.co>";

// ── Welcome Email ─────────────────────────────────
export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
  trialEndsAt: Date;
}) {
  const trialDate = opts.trialEndsAt.toLocaleDateString("tr-TR", {
    day: "numeric", month: "long", year: "numeric",
  });

  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: "🎉 Zyrix FinSuite'e Hoş Geldiniz! 30 Günlük Denemeniz Başladı",
    html: `
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(108,58,255,0.10);">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6C3AFF 0%,#F43F8E 100%);padding:40px 40px 32px;text-align:center;position:relative;">
      <div style="width:60px;height:60px;background:rgba(255,255,255,0.2);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="color:#fff;font-weight:900;font-size:28px;">Z</span>
      </div>
      <h1 style="color:#fff;margin:0 0 8px;font-size:26px;font-weight:800;">Hoş Geldiniz, ${opts.name}! 🎉</h1>
      <p style="color:rgba(255,255,255,0.85);margin:0;font-size:15px;">Zyrix FinSuite ailenize katıldığınız için teşekkürler</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 40px;">
      
      <!-- Trial badge -->
      <div style="background:#10B98112;border:1.5px solid #10B98125;border-radius:14px;padding:16px 20px;margin-bottom:28px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:28px;">🎁</span>
        <div>
          <div style="color:#10B981;font-size:14px;font-weight:700;margin-bottom:3px;">30 Günlük Ücretsiz Deneme Aktif!</div>
          <div style="color:#64748B;font-size:13px;">Deneme süreniz <strong>${trialDate}</strong> tarihinde sona erecek.</div>
        </div>
      </div>

      <p style="color:#1E1B4B;font-size:15px;line-height:1.7;margin:0 0 24px;">
        Hesabınız başarıyla oluşturuldu. Zyrix FinSuite ile işletmenizi daha akıllı yönetmeye hemen başlayabilirsiniz.
      </p>

      <!-- Features -->
      <div style="background:#F8FAFF;border-radius:14px;padding:24px;margin-bottom:28px;">
        <div style="color:#1E1B4B;font-size:14px;font-weight:700;margin-bottom:16px;">✨ Neler Yapabilirsiniz?</div>
        ${[
          ["📄","Fatura oluşturun ve müşterilerinize gönderin"],
          ["👥","Müşterilerinizi CRM ile yönetin"],
          ["🤝","Satış pipeline'ınızı takip edin"],
          ["🤖","AI destekli iş analitiği alın"],
          ["📊","Gelir & gider raporlarınızı görün"],
        ].map(([icon, text]) => `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="width:32px;height:32px;background:#6C3AFF15;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">${icon}</div>
            <span style="color:#64748B;font-size:14px;">${text}</span>
          </div>
        `).join("")}
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://finsuite.zyrix.co/dashboard" style="display:inline-block;background:linear-gradient(135deg,#6C3AFF,#F43F8E);color:#fff;text-decoration:none;border-radius:12px;padding:14px 36px;font-size:15px;font-weight:700;box-shadow:0 4px 20px rgba(108,58,255,0.30);">
          Dashboard'a Git →
        </a>
      </div>

      <!-- Grace period note -->
      <div style="background:#F59E0B10;border:1px solid #F59E0B25;border-radius:12px;padding:14px 18px;">
        <div style="color:#F59E0B;font-size:13px;font-weight:700;margin-bottom:4px;">⚡ Önemli Bilgi</div>
        <div style="color:#64748B;font-size:12px;line-height:1.6;">
          30 günlük deneme sonunda abonelik seçmezseniz hesabınız askıya alınır — ancak <strong>verileriniz silinmez</strong>. İstediğiniz zaman geri dönüp kaldığınız yerden devam edebilirsiniz.
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#F8FAFF;padding:20px 40px;text-align:center;border-top:1px solid #E2E8F8;">
      <p style="color:#94A3B8;font-size:12px;margin:0;">
        Zyrix FinSuite © 2026 — 🇹🇷 Türkiye'de yapıldı<br>
        <a href="https://finsuite.zyrix.co" style="color:#6C3AFF;text-decoration:none;">finsuite.zyrix.co</a>
      </p>
    </div>
  </div>
</body>
</html>
    `,
  });
}

// ── Trial Expiry Warning (3 days before) ──────────
export async function sendTrialExpiryWarning(opts: {
  to: string;
  name: string;
  trialEndsAt: Date;
}) {
  const trialDate = opts.trialEndsAt.toLocaleDateString("tr-TR", {
    day: "numeric", month: "long", year: "numeric",
  });

  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `⚡ Deneme süreniz ${trialDate} tarihinde bitiyor — Verilerinizi kaybetmeyin!`,
    html: `
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(108,58,255,0.10);">
    <div style="background:linear-gradient(135deg,#F59E0B,#F97316);padding:32px 40px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">⏰</div>
      <h1 style="color:#fff;margin:0 0 8px;font-size:22px;font-weight:800;">Deneme Süreniz Bitiyor!</h1>
      <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;">${trialDate} tarihinde sona erecek</p>
    </div>
    <div style="padding:32px 40px;">
      <p style="color:#1E1B4B;font-size:15px;line-height:1.7;">Merhaba <strong>${opts.name}</strong>,</p>
      <p style="color:#64748B;font-size:14px;line-height:1.7;">30 günlük ücretsiz deneme süreniz yakında bitiyor. Abonelik seçerek işletmenizi yönetmeye kesintisiz devam edebilirsiniz.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="https://finsuite.zyrix.co/dashboard" style="display:inline-block;background:linear-gradient(135deg,#F59E0B,#F97316);color:#fff;text-decoration:none;border-radius:12px;padding:14px 32px;font-size:15px;font-weight:700;">
          Abonelik Seç →
        </a>
      </div>
      <div style="background:#10B98108;border:1px solid #10B98120;border-radius:12px;padding:14px 18px;">
        <div style="color:#10B981;font-size:13px;font-weight:700;margin-bottom:4px;">🛡️ Verileriniz Güvende</div>
        <div style="color:#64748B;font-size:12px;line-height:1.6;">Abonelik yapmasanız bile verileriniz silinmez. 10 günlük ek süre sonunda hesap askıya alınır — istediğiniz zaman geri dönebilirsiniz.</div>
      </div>
    </div>
    <div style="background:#F8FAFF;padding:16px 40px;text-align:center;border-top:1px solid #E2E8F8;">
      <p style="color:#94A3B8;font-size:12px;margin:0;">Zyrix FinSuite © 2026 — <a href="https://finsuite.zyrix.co" style="color:#6C3AFF;text-decoration:none;">finsuite.zyrix.co</a></p>
    </div>
  </div>
</body>
</html>
    `,
  });
}

// ── Account Suspended Warning ─────────────────────
export async function sendSuspensionWarning(opts: {
  to: string;
  name: string;
}) {
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: "⚠️ Hesabınız askıya alındı — Verileriniz güvende",
    html: `
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(244,63,94,0.10);">
    <div style="background:linear-gradient(135deg,#F43F5E,#F97316);padding:32px 40px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">🔒</div>
      <h1 style="color:#fff;margin:0 0 8px;font-size:22px;font-weight:800;">Hesabınız Askıya Alındı</h1>
    </div>
    <div style="padding:32px 40px;">
      <p style="color:#1E1B4B;font-size:15px;line-height:1.7;">Merhaba <strong>${opts.name}</strong>,</p>
      <p style="color:#64748B;font-size:14px;line-height:1.7;">Ödeme yapılmadığı için hesabınız askıya alınmıştır. Endişelenmeyin — <strong>tüm verileriniz güvende tutulmaktadır</strong>.</p>
      <div style="background:#10B98108;border:1px solid #10B98120;border-radius:12px;padding:16px 20px;margin:20px 0;">
        <div style="color:#10B981;font-size:14px;font-weight:700;margin-bottom:8px;">✅ Verileriniz Silinmedi</div>
        <div style="color:#64748B;font-size:13px;line-height:1.6;">Abonelik yenilediğinizde tüm müşteri, fatura ve deal verilerinize tam olarak erişebileceksiniz. Kaldığınız yerden devam edersiniz.</div>
      </div>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://finsuite.zyrix.co/dashboard" style="display:inline-block;background:linear-gradient(135deg,#6C3AFF,#F43F8E);color:#fff;text-decoration:none;border-radius:12px;padding:14px 32px;font-size:15px;font-weight:700;">
          Hesabı Yeniden Aktifleştir →
        </a>
      </div>
    </div>
    <div style="background:#F8FAFF;padding:16px 40px;text-align:center;border-top:1px solid #E2E8F8;">
      <p style="color:#94A3B8;font-size:12px;margin:0;">Zyrix FinSuite © 2026 — <a href="https://finsuite.zyrix.co" style="color:#6C3AFF;text-decoration:none;">finsuite.zyrix.co</a></p>
    </div>
  </div>
</body>
</html>
    `,
  });
}