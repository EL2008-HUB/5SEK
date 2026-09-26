const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@5sek.app";
const PRIVACY_EMAIL = process.env.PRIVACY_EMAIL || "privacy@5sek.app";

const termsDocument = {
  version: "1.0.0",
  lastUpdated: "2026-04-21",
  sections: [
    { title: "Acceptance of Terms", content: "By accessing or using 5SEK, you agree to be bound by these Terms of Service." },
    { title: "Description of Service", content: "5SEK is a social video platform where users create and share 5-second video answers to daily questions." },
    { title: "User Accounts", content: "You must be at least 16 years old to use 5SEK. You are responsible for maintaining the security of your account." },
    { title: "Content Guidelines", content: "You retain ownership of content you post. Content must not violate laws or contain hate speech, violence, or adult content." },
    { title: "Prohibited Activities", content: "Users may not spam, harass others, impersonate, or circumvent security measures." },
    { title: "Termination", content: "We may terminate or suspend your account immediately for any violation of these terms." },
    { title: "Disclaimer", content: '5SEK is provided "as is" without warranties of any kind.' },
    { title: "Limitation of Liability", content: "5SEK shall not be liable for any indirect, incidental, or consequential damages." },
    { title: "Changes to Terms", content: "We may modify these terms at any time. Continued use constitutes acceptance." },
    { title: "Contact", content: `For questions about these Terms, contact ${SUPPORT_EMAIL}` },
  ],
};

const privacyDocument = {
  version: "1.0.0",
  lastUpdated: "2026-04-21",
  sections: [
    { title: "Information We Collect", content: "We collect account info, profile data, content, usage data, device info, and country." },
    { title: "How We Use Information", content: "We use data to provide and improve the service, personalize content, ensure safety, and comply with legal obligations." },
    { title: "Data Sharing", content: "We share data with service providers and legal authorities when required. We do not sell personal data." },
    { title: "Data Retention", content: "We retain data while your account is active. Deleted content may remain in backups for up to 30 days." },
    { title: "Your Rights", content: "You may access, correct, delete, export, or object to processing of your data." },
    { title: "Cookies and Tracking", content: "We use cookies and similar technologies when you consent." },
    { title: "Security", content: "We implement encryption, access controls, and security reviews." },
    { title: "Children's Privacy", content: "We do not knowingly collect data from children under 16." },
    { title: "International Transfers", content: "Data may be processed outside your residence with appropriate safeguards." },
    { title: "Changes to Privacy Policy", content: "We may update this policy periodically and notify you of significant changes." },
  ],
  contact: PRIVACY_EMAIL,
};

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderLegalHtml({ title, document }) {
  const sections = (document.sections || [])
    .map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.content)}</p></section>`)
    .join("\n");
  const contact = document.contact || SUPPORT_EMAIL;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(title)} · 5SEK</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#0f0f1a;color:#f5f5f7;line-height:1.6}main{max-width:720px;margin:0 auto;padding:32px 20px 64px}h1{font-size:2rem}section{margin-bottom:1.5rem}h2{font-size:1.15rem}a{color:#73d9d0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>Version ${escapeHtml(document.version)} · Updated ${escapeHtml(document.lastUpdated)}</p>${sections}<footer><p>Contact: <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a></p><p><a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a></p></footer></main></body></html>`;
}

module.exports = { SUPPORT_EMAIL, PRIVACY_EMAIL, termsDocument, privacyDocument, renderLegalHtml };
