const { Entity, Case } = require('../models');
const { runCrossCaseLinking } = require('../services/crossCaseLinkingService');

/**
 * Nightly cron job — re-runs cross-case linking for ALL completed cases.
 *
 * Catches any new entity overlaps introduced by cases processed after the
 * initial fire-and-forget trigger on case completion.
 *
 * Scheduled by server.js after DB connects.
 * Default interval: every 24 hours (configurable via CROSS_CASE_CRON_INTERVAL_MS env var).
 */

let cronTimer = null;

const INTERVAL_MS =
  parseInt(process.env.CROSS_CASE_CRON_INTERVAL_MS, 10) || 24 * 60 * 60 * 1000; // 24 hours

const runNightlyCron = async () => {
  const tag = '[crossCaseCron]';
  console.log(`${tag} Starting nightly cross-case linking sweep...`);

  try {
    const completedCases = await Case.find({ status: 'completed' })
      .select('caseId')
      .lean();

    console.log(`${tag} Found ${completedCases.length} completed cases to process.`);

    let totalLinked = 0;
    let totalEdges = 0;
    let totalNeighbors = 0;

    for (const caseDoc of completedCases) {
      try {
        const result = await runCrossCaseLinking(caseDoc.caseId);
        totalLinked += result.linked;
        totalEdges += result.edgesCreated;
        totalNeighbors += result.neighborsLinked;
      } catch (err) {
        console.error(`${tag} Failed for case ${caseDoc.caseId}:`, err.message);
        // Continue with remaining cases — non-fatal
      }
    }

    console.log(
      `${tag} Sweep complete — ${totalLinked} links, ${totalEdges} bridge edges, ${totalNeighbors} neighbors.`
    );
  } catch (err) {
    console.error(`${tag} Sweep failed:`, err.message);
  }
};

/**
 * Start the nightly cron timer.
 * Safe to call multiple times — existing timer is cleared before starting a new one.
 */
const startCrossCaseCron = () => {
  if (cronTimer) {
    clearInterval(cronTimer);
  }

  // Run once on startup (after a short delay to let DB settle)
  setTimeout(() => {
    runNightlyCron().catch((err) =>
      console.error('[crossCaseCron] Initial sweep failed:', err.message)
    );
  }, 30 * 1000); // 30 seconds after server start

  // Then run on the configured interval
  cronTimer = setInterval(() => {
    runNightlyCron().catch((err) =>
      console.error('[crossCaseCron] Scheduled sweep failed:', err.message)
    );
  }, INTERVAL_MS);

  console.log(
    `[crossCaseCron] Scheduled — interval: ${INTERVAL_MS / 1000 / 60 / 60}h, first run: 30s after boot`
  );
};

/**
 * Stop the cron timer (used during graceful shutdown).
 */
const stopCrossCaseCron = () => {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    console.log('[crossCaseCron] Stopped.');
  }
};

module.exports = { startCrossCaseCron, stopCrossCaseCron, runNightlyCron };
