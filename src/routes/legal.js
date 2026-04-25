/**
 * Legal/Privacy Routes - Terms, Privacy, GDPR compliance
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, optionalAuthMiddleware } = require('../controllers/authController');
const { revokeAllUserSessions } = require('../services/authSessionService');
const { revokeUserPushTokens } = require('../services/pushNotificationService');
const { createBillingPortalSession, hasStripeConfig } = require('../services/stripeService');
const {
  EXPORT_TTL_MS,
  buildDownloadUrl,
  buildSignedCloudinaryDownloadUrl,
  getExportFilePath,
  isCloudinaryExportRef,
  processExportRequest,
} = require('../services/exportService');

function serializeExportRequest(request) {
  if (!request) {
    return null;
  }

  return {
    id: request.id,
    status: request.status,
    exportType: request.export_type,
    downloadUrl:
      request.status === 'ready' || request.status === 'downloaded'
        ? buildDownloadUrl(request.id)
        : null,
    processedAt: request.processed_at,
    expiresAt: request.expires_at,
    createdAt: request.created_at,
  };
}

// Terms of Service
router.get('/terms', (req, res) => {
  const terms = {
    version: '1.0.0',
    lastUpdated: '2026-04-21',
    sections: [
      {
        title: 'Acceptance of Terms',
        content: 'By accessing or using 5SEK, you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the service.'
      },
      {
        title: 'Description of Service',
        content: '5SEK is a social video platform where users create and share 5-second video answers to daily questions.'
      },
      {
        title: 'User Accounts',
        content: 'You must be at least 13 years old to use 5SEK. You are responsible for maintaining the security of your account and for all activities that occur under your account.'
      },
      {
        title: 'Content Guidelines',
        content: 'You retain ownership of content you post. By posting, you grant 5SEK a license to use, modify, and display your content. Content must not violate laws, infringe rights, or contain hate speech, violence, or adult content.'
      },
      {
        title: 'Prohibited Activities',
        content: 'Users may not: spam, harass others, impersonate, distribute malware, scrape data, or circumvent security measures.'
      },
      {
        title: 'Termination',
        content: 'We may terminate or suspend your account immediately for any violation of these terms.'
      },
      {
        title: 'Disclaimer',
        content: '5SEK is provided "as is" without warranties of any kind.'
      },
      {
        title: 'Limitation of Liability',
        content: '5SEK shall not be liable for any indirect, incidental, or consequential damages.'
      },
      {
        title: 'Changes to Terms',
        content: 'We reserve the right to modify these terms at any time. Continued use constitutes acceptance of changes.'
      },
      {
        title: 'Contact',
        content: 'For questions about these Terms, contact support@5sek.app'
      }
    ]
  };

  res.json(terms);
});

// Privacy Policy
router.get('/privacy', (req, res) => {
  const privacy = {
    version: '1.0.0',
    lastUpdated: '2026-04-21',
    sections: [
      {
        title: 'Information We Collect',
        content: 'We collect: account info (username, email), profile data (age group, interests), content (videos, answers), usage data (views, interactions), device info, and location (country).'
      },
      {
        title: 'How We Use Information',
        content: 'We use data to: provide and improve the service, personalize content, ensure safety, process payments, send notifications, and comply with legal obligations.'
      },
      {
        title: 'Data Sharing',
        content: 'We share data with: service providers (hosting, analytics), payment processors, and legal authorities when required. We do not sell personal data.'
      },
      {
        title: 'Data Retention',
        content: 'We retain data as long as your account is active. Deleted content may remain in backups for up to 30 days. Analytics data is anonymized after 1 year.'
      },
      {
        title: 'Your Rights',
        content: 'You have the right to: access your data, correct inaccuracies, delete your account, export your data, and object to processing.'
      },
      {
        title: 'Cookies and Tracking',
        content: 'We use cookies and similar technologies for authentication, analytics, and personalization.'
      },
      {
        title: 'Security',
        content: 'We implement industry-standard security measures including encryption, access controls, and regular security audits.'
      },
      {
        title: 'Children\'s Privacy',
        content: 'We do not knowingly collect data from children under 13. If you believe we have, contact us immediately.'
      },
      {
        title: 'International Transfers',
        content: 'Data may be processed in countries outside your residence. We ensure appropriate safeguards are in place.'
      },
      {
        title: 'Changes to Privacy Policy',
        content: 'We may update this policy periodically. Significant changes will be notified via email or app notification.'
      }
    ],
    contact: 'privacy@5sek.app'
  };

  res.json(privacy);
});

// Cookie Policy
router.get('/cookies', (req, res) => {
  const cookies = {
    policy: 'We use cookies to enhance your experience.',
    types: [
      { type: 'essential', purpose: 'Required for the app to function', required: true },
      { type: 'analytics', purpose: 'Help us understand usage patterns', required: false },
      { type: 'preferences', purpose: 'Remember your settings', required: false }
    ],
    consentRequired: true
  };

  res.json(cookies);
});

// GDPR - Data Export
router.post('/export-data', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { exportType = 'full' } = req.body;
    const validExportTypes = ['full', 'answers_only', 'account_only'];
    if (!validExportTypes.includes(String(exportType || ''))) {
      return res.status(400).json({ error: 'invalid_export_type' });
    }

    const [existingPending] = await req.db('data_export_requests')
      .where('user_id', userId)
      .whereIn('status', ['pending', 'processing', 'ready'])
      .orderBy('created_at', 'desc')
      .limit(1);

    if (
      existingPending &&
      existingPending.status === 'ready' &&
      existingPending.expires_at &&
      new Date(existingPending.expires_at).getTime() <= Date.now()
    ) {
      await req.db('data_export_requests')
        .where('id', existingPending.id)
        .update({
          status: 'expired',
          updated_at: new Date(),
        });
    } else if (existingPending && existingPending.status !== 'expired') {
      return res.status(202).json({
        success: true,
        request: serializeExportRequest(existingPending),
      });
    }

    const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
    const [request] = await req.db('data_export_requests').insert({
      user_id: userId,
      export_type: exportType,
      status: 'pending',
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');

    processExportRequest(req.db, request.id).catch((error) => {
      console.error('Async export processing error:', error);
    });

    res.status(202).json({
      success: true,
      request: serializeExportRequest(request),
    });

  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ error: 'failed_to_export' });
  }
});

router.get('/export-requests', authMiddleware, async (req, res) => {
  try {
    const requests = await req.db('data_export_requests')
      .where('user_id', req.userId)
      .orderBy('created_at', 'desc');

    res.json({
      requests: requests.map(serializeExportRequest),
    });
  } catch (error) {
    console.error('List export requests error:', error);
    res.status(500).json({ error: 'failed_to_list_exports' });
  }
});

router.get('/export-data/:requestId/link', authMiddleware, async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);
    if (!requestId) {
      return res.status(400).json({ error: 'invalid_request_id' });
    }

    const request = await req.db('data_export_requests')
      .where({
        id: requestId,
        user_id: req.userId,
      })
      .first();

    if (!request) {
      return res.status(404).json({ error: 'export_request_not_found' });
    }

    if (request.status !== 'ready' && request.status !== 'downloaded') {
      return res.status(409).json({ error: 'export_not_ready' });
    }

    if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
      await req.db('data_export_requests')
        .where('id', requestId)
        .update({
          status: 'expired',
          updated_at: new Date(),
        });
      return res.status(410).json({ error: 'export_expired' });
    }

    if (!isCloudinaryExportRef(request.download_url)) {
      return res.status(409).json({ error: 'signed_export_unavailable_for_local_storage' });
    }

    const signedUrl = buildSignedCloudinaryDownloadUrl(request.download_url, request.expires_at);
    if (!signedUrl) {
      return res.status(500).json({ error: 'export_download_unavailable' });
    }

    return res.json({
      downloadUrl: signedUrl,
      expiresAt: request.expires_at,
      status: request.status,
    });
  } catch (error) {
    console.error('Get export signed link error:', error);
    return res.status(500).json({ error: 'failed_to_get_export_link' });
  }
});

router.get('/export-data/:requestId/download', authMiddleware, async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);
    if (!requestId) {
      return res.status(400).json({ error: 'invalid_request_id' });
    }

    const request = await req.db('data_export_requests')
      .where({
        id: requestId,
        user_id: req.userId,
      })
      .first();

    if (!request) {
      return res.status(404).json({ error: 'export_request_not_found' });
    }

    if (request.status !== 'ready' || !request.download_url) {
      return res.status(409).json({ error: 'export_not_ready' });
    }

    if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
      await req.db('data_export_requests')
        .where('id', requestId)
        .update({
          status: 'expired',
          updated_at: new Date(),
        });
      return res.status(410).json({ error: 'export_expired' });
    }

    await req.db('data_export_requests')
      .where('id', requestId)
      .update({
        status: 'downloaded',
        updated_at: new Date(),
      });

    if (isCloudinaryExportRef(request.download_url)) {
      const signedUrl = buildSignedCloudinaryDownloadUrl(request.download_url, request.expires_at);
      if (!signedUrl) {
        return res.status(500).json({ error: 'export_download_unavailable' });
      }
      return res.redirect(signedUrl);
    }

    const filePath = getExportFilePath(requestId);
    return res.download(filePath, `5sek-export-${requestId}.json`);
  } catch (error) {
    console.error('Download export error:', error);
    res.status(500).json({ error: 'failed_to_download_export' });
  }
});

// GDPR - Delete Account
router.post('/delete-account', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { confirmation } = req.body;
    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({ 
        error: 'confirmation_required',
        message: 'Please confirm by sending confirmation: "DELETE_MY_ACCOUNT"'
      });
    }

    const user = await req.db('users').where('id', userId).first();
    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const deletionDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await req.db('users')
      .where('id', userId)
      .update({
        deletion_requested_at: new Date(),
        deletion_deadline_at: deletionDeadline,
        delete_reason: 'user_requested_account_deletion',
        updated_at: new Date()
      });

    await revokeAllUserSessions(req.db, userId);
    await revokeUserPushTokens(req.db, userId);

    let billingPortalUrl = null;
    if (user.stripe_customer_id && hasStripeConfig()) {
      try {
        const portal = await createBillingPortalSession(req.db, user);
        billingPortalUrl = portal?.url || null;
      } catch (portalError) {
        console.error('Billing portal generation failed during deletion request:', portalError);
      }
    }

    res.json({
      success: true,
      message: 'Account scheduled for deletion. Your data will be permanently deleted within 30 days unless you cancel the request.',
      deletionRequestedAt: new Date().toISOString(),
      deletionDate: deletionDeadline.toISOString(),
      billingPortalUrl,
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'failed_to_delete' });
  }
});

// Get deletion status
router.get('/deletion-status', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const user = await req.db('users')
      .where('id', userId)
      .select('deleted_at', 'deletion_requested_at', 'deletion_deadline_at')
      .first();

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    if (!user.deletion_requested_at) {
      return res.json({
        status: 'active',
        message: 'Account is active'
      });
    }

    res.json({
      status: 'scheduled_for_deletion',
      requestedAt: user.deletion_requested_at,
      permanentDeletionDate: user.deletion_deadline_at,
      daysRemaining: Math.max(
        0,
        Math.ceil((new Date(user.deletion_deadline_at) - new Date()) / (1000 * 60 * 60 * 24))
      ),
      canBeReversed: true
    });

  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_status' });
  }
});

// Cancel deletion (within grace period)
router.post('/cancel-deletion', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const user = await req.db('users')
      .where('id', userId)
      .whereNotNull('deletion_requested_at')
      .first();

    if (!user) {
      return res.status(400).json({ error: 'no_deletion_scheduled' });
    }

    // Check if still in grace period
    if (user.deletion_deadline_at && new Date() > new Date(user.deletion_deadline_at)) {
      return res.status(400).json({ error: 'deletion_already_processed' });
    }

    await req.db('users')
      .where('id', userId)
      .update({
        deletion_requested_at: null,
        deletion_deadline_at: null,
        delete_reason: null,
        updated_at: new Date()
      });

    res.json({
      success: true,
      message: 'Account deletion cancelled. Your account has been restored.'
    });

  } catch (error) {
    res.status(500).json({ error: 'failed_to_cancel' });
  }
});

// Consent management
router.post('/consent', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { analytics, marketing, thirdParty } = req.body;

    await req.db('user_consents').insert({
      user_id: userId,
      analytics_consent: analytics || false,
      marketing_consent: marketing || false,
      third_party_consent: thirdParty || false,
      consented_at: new Date()
    }).onConflict('user_id').merge();

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: 'failed_to_save_consent' });
  }
});

router.get('/consent', optionalAuthMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.json({
        analytics: false,
        marketing: false,
        thirdParty: false,
        required: ['essential']
      });
    }

    const consent = await req.db('user_consents')
      .where('user_id', userId)
      .first();

    res.json({
      analytics: consent?.analytics_consent || false,
      marketing: consent?.marketing_consent || false,
      thirdParty: consent?.third_party_consent || false,
      consentedAt: consent?.consented_at,
      required: ['essential']
    });

  } catch (error) {
    res.status(500).json({ error: 'failed_to_get_consent' });
  }
});

module.exports = router;
