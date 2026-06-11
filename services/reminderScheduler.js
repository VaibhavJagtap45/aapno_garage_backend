// services/reminderScheduler.js
// ─────────────────────────────────────────────────────────────────
//  Lightweight, dependency-free scheduler for service reminders.
//
//  Runs dispatchDueReminders() on a fixed interval (default hourly).
//  No external cron library — a guarded setInterval is enough for a
//  single-instance Node process and keeps the dependency surface small.
//
//  NOTE: if you ever run multiple backend instances, gate this behind a
//  leader-election / distributed lock so reminders aren't sent twice.
//
//  Config (env):
//    REMINDER_SCHEDULER_ENABLED      "false" to disable          (default on)
//    REMINDER_SCHEDULER_INTERVAL_MIN minutes between runs         (default 60)
// ─────────────────────────────────────────────────────────────────

const { dispatchDueReminders } = require("./customerReminder.service");

let timer = null;
let running = false; // re-entrancy guard — skip a tick if the prior run is slow

async function runOnce() {
  if (running) return; // previous tick still in flight
  running = true;
  try {
    const summary = await dispatchDueReminders();
    if (summary.sent || summary.failed) {
      console.info(
        `[ReminderScheduler] scanned=${summary.scanned} sent=${summary.sent} failed=${summary.failed}`,
      );
    }
  } catch (err) {
    console.error("[ReminderScheduler] run failed:", err.message);
  } finally {
    running = false;
  }
}

function startReminderScheduler() {
  if (String(process.env.REMINDER_SCHEDULER_ENABLED).toLowerCase() === "false") {
    console.info("[ReminderScheduler] disabled via REMINDER_SCHEDULER_ENABLED=false");
    return;
  }
  if (timer) return; // already started

  const intervalMin = Math.max(Number(process.env.REMINDER_SCHEDULER_INTERVAL_MIN) || 60, 1);
  const intervalMs = intervalMin * 60 * 1000;

  // First sweep shortly after boot, then on the interval.
  setTimeout(runOnce, 30 * 1000).unref?.();
  timer = setInterval(runOnce, intervalMs);
  timer.unref?.(); // don't keep the event loop alive on its own

  console.info(`[ReminderScheduler] started — every ${intervalMin} min`);
}

function stopReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startReminderScheduler, stopReminderScheduler, runOnce };
