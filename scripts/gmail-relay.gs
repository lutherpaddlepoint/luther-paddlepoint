// Gmail relay for Luther PaddlePoint & Pool.
// Render's free plan blocks email (SMTP), so the website sends emails through this
// Google Apps Script, which sends them from your own Gmail account.
//
// Setup (once): script.google.com > New project > paste this file > put your secret below >
// Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > copy the URL.
// Put the URL in Render as MAIL_RELAY_URL and the same secret as MAIL_RELAY_SECRET.
// Limit: about 100 emails per day on a free Gmail account.

const SECRET = "PASTE-YOUR-SECRET-HERE";
const SENDER_NAME = "Luther PaddlePoint & Pool";

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (SECRET.indexOf("PASTE-") === 0 || d.secret !== SECRET) return reply({ ok: false, error: "wrong secret" });
    if (!d.to || !d.subject) return reply({ ok: false, error: "missing to or subject" });
    const options = { name: SENDER_NAME, htmlBody: d.html || undefined };
    if (d.qrBase64) {
      options.inlineImages = { qr: Utilities.newBlob(Utilities.base64Decode(d.qrBase64), "image/png", "booking-qr.png") };
    }
    MailApp.sendEmail(d.to, d.subject, d.text || "", options);
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err).slice(0, 300) });
  }
}

// Run this once from the editor (select "authorize", then Run) to give the script permission to send email.
function authorize() {
  MailApp.getRemainingDailyQuota();
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
