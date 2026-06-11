// ─── services/pushNotification.service.js ────────────────────────────────────
//  Sends push notifications via the Expo Push API.
//  Uses axios (already in package.json) — no extra SDK needed.
//
//  Key production behaviours:
//   • Batches messages (Expo limit: 100 per request)
//   • Auto-clears stale tokens (DeviceNotRegistered) from MongoDB
//   • All sends are fire-and-forget from controllers — never blocks responses
//   • Brand color (#1D9E75) applied to all Android notifications
//   • App logo (assets/logo.png) used via expo-notifications plugin in app.json
// ─────────────────────────────────────────────────────────────────────────────

const axios = require("axios");
const User  = require("../models/User.model");

const EXPO_PUSH_URL  = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE     = 100;          // Expo's per-request limit
const BRAND_COLOR    = "#1D9E75";    // Primary green — matches app.json notification color

// ── Notification templates ────────────────────────────────────────────────────
//  Customer templates  — sent to the vehicle owner (customer role)
//  Owner templates     — sent to the garage owner / staff
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  // ── Customer ──────────────────────────────────────────────────────────────

  // Customer receives when owner creates a booking for them
  BOOKING_CONFIRMED: (bookingNo) => ({
    title: "Booking Confirmed 🎉",
    body:  `Your booking ${bookingNo} has been confirmed. We'll see you soon!`,
    data:  { type: "BOOKING_CONFIRMED", bookingNo },
  }),

  // Customer receives when a new repair order is opened for them
  REPAIR_ORDER_CREATED: (orderNo) => ({
    title: "Repair Order Created 🔧",
    body:  `Your repair order ${orderNo} has been opened. We'll start work soon.`,
    data:  { type: "REPAIR_ORDER_CREATED", orderNo },
  }),

  // Customer receives when status → in_progress
  REPAIR_STARTED: (orderNo) => ({
    title: "Work Started 🔨",
    body:  `We've started working on your vehicle (Order: ${orderNo}).`,
    data:  { type: "REPAIR_STARTED", orderNo },
  }),

  // Customer receives when status → vehicle_ready
  VEHICLE_READY: (orderNo, garageName) => ({
    title: "Vehicle Ready! 🚗",
    body:  `Your vehicle is ready for pickup at ${garageName}. (Order: ${orderNo})`,
    data:  { type: "VEHICLE_READY", orderNo },
  }),

  // Customer receives when status → completed
  REPAIR_COMPLETED: (orderNo) => ({
    title: "Repair Completed ✅",
    body:  `Order ${orderNo} is complete. Thank you for choosing us!`,
    data:  { type: "REPAIR_COMPLETED", orderNo },
  }),

  // Customer receives right after the invoice is generated — confirms the
  // service is done and tells them when the next one is due.
  SERVICE_DONE: ({ serviceLabel, nextServiceKm, dueDateLabel }) => ({
    title: "Service Completed ✅",
    body:
      `${serviceLabel || "Your service"} is done.` +
      (nextServiceKm ? ` Next service at ${nextServiceKm} km` : "") +
      (dueDateLabel ? ` (around ${dueDateLabel}).` : "."),
    data:  { type: "SERVICE_DONE" },
  }),

  // Customer receives when a service reminder falls due.
  SERVICE_REMINDER_DUE: ({ serviceLabel, nextServiceKm, garageName }) => ({
    title: "Service Reminder 🔔",
    body:
      `${serviceLabel || "Your next service"} is due` +
      (nextServiceKm ? ` around ${nextServiceKm} km` : " soon") +
      `. Book a slot at ${garageName || "your garage"}.`,
    data:  { type: "SERVICE_REMINDER_DUE" },
  }),

  // ── Owner / Staff ─────────────────────────────────────────────────────────

  // Owner receives when a new repair order is created (by owner or customer)
  OWNER_ORDER_CREATED: (orderNo, customerName) => ({
    title: "New Repair Order 🔧",
    body:  `Order ${orderNo} created${customerName ? ` for ${customerName}` : ""}.`,
    data:  { type: "OWNER_ORDER_CREATED", orderNo },
  }),

  // Owner receives when a mechanic (member) marks order as in_progress
  OWNER_REPAIR_STARTED: (orderNo) => ({
    title: "Work Started 🔨",
    body:  `Order ${orderNo} is now in progress.`,
    data:  { type: "OWNER_REPAIR_STARTED", orderNo },
  }),

  // Owner receives when status → vehicle_ready
  OWNER_VEHICLE_READY: (orderNo, customerName) => ({
    title: "Vehicle Ready for Pickup 🚗",
    body:  `Order ${orderNo}${customerName ? ` (${customerName})` : ""} — vehicle ready.`,
    data:  { type: "OWNER_VEHICLE_READY", orderNo },
  }),

  // Owner receives when status → completed
  OWNER_REPAIR_COMPLETED: (orderNo) => ({
    title: "Order Completed ✅",
    body:  `Order ${orderNo} has been marked as completed.`,
    data:  { type: "OWNER_REPAIR_COMPLETED", orderNo },
  }),

  // Owner receives when a customer cancels their order
  OWNER_ORDER_CANCELLED: (orderNo, customerName) => ({
    title: "Order Cancelled ❌",
    body:  `${customerName || "A customer"} cancelled order ${orderNo}.`,
    data:  { type: "OWNER_ORDER_CANCELLED", orderNo },
  }),
};

// ── Internal: send a batch of pre-built Expo messages ────────────────────────
async function _dispatch(messages) {
  if (!messages.length) return;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    try {
      const { data: body } = await axios.post(EXPO_PUSH_URL, batch, {
        headers: {
          "Content-Type":    "application/json",
          "Accept":          "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        timeout: 10_000,
      });

      // ── Handle receipt-level errors ────────────────────────────────────────
      const receipts    = body?.data ?? [];
      const staleTokens = [];

      receipts.forEach((receipt, idx) => {
        if (receipt.status !== "error") return;

        console.warn(
          `[Push] Delivery error for ${batch[idx]?.to}:`,
          receipt.message,
          receipt.details?.error,
        );

        // Auto-remove tokens that Expo reports as unregistered
        if (receipt.details?.error === "DeviceNotRegistered") {
          staleTokens.push(batch[idx]?.to);
        }
      });

      if (staleTokens.length) {
        // Fire-and-forget — DB cleanup must not block caller
        User.updateMany(
          { pushToken: { $in: staleTokens } },
          { $set: { pushToken: null } },
        ).catch((err) =>
          console.error("[Push] Stale token cleanup failed:", err.message),
        );
      }
    } catch (err) {
      // Network / Expo outage — log and continue; never crash the caller
      console.error("[Push] Batch dispatch failed:", err.message);
    }
  }
}

// ── _buildMessages ────────────────────────────────────────────────────────────
//  Builds Expo push message objects from a list of push tokens and a template.
//  Applies brand color and channel for consistent appearance across devices.
// ─────────────────────────────────────────────────────────────────────────────
function _buildMessages(pushTokens, template) {
  return pushTokens.map((token) => ({
    to:        token,
    sound:     "default",
    title:     template.title,
    body:      template.body,
    data:      template.data ?? {},
    priority:  "high",
    channelId: "default",   // Android notification channel (configured in app.json)
    color:     BRAND_COLOR, // Android accent color for the notification icon
    badge:     1,
  }));
}

// ── notifyUser ────────────────────────────────────────────────────────────────
//  Send a notification to a single user identified by their MongoDB _id.
//  Silently no-ops if the user has no push token (never throws).
// ─────────────────────────────────────────────────────────────────────────────
async function notifyUser(userId, template) {
  if (!userId || !template) return;
  return notifyUsers([userId], template);
}

// ── notifyUsers ───────────────────────────────────────────────────────────────
//  Send the same notification to multiple user IDs.
//  Looks up their pushTokens in one DB query, then batches the send.
// ─────────────────────────────────────────────────────────────────────────────
async function notifyUsers(userIds, template) {
  if (!userIds?.length || !template) return;

  const validIds = userIds.filter(Boolean);
  if (!validIds.length) return;

  // Single query — only fetch users that actually have a token
  const users = await User.find(
    {
      _id:       { $in: validIds },
      pushToken: { $ne: null, $exists: true },
    },
    { pushToken: 1 },
  ).lean();

  if (!users.length) return;

  const messages = _buildMessages(
    users.map((u) => u.pushToken),
    template,
  );

  await _dispatch(messages);
}

// ── notifyBoth ────────────────────────────────────────────────────────────────
//  Send different messages to customer and owner simultaneously.
//  Runs two notifyUser calls concurrently — total latency is max(a, b), not a+b.
// ─────────────────────────────────────────────────────────────────────────────
async function notifyBoth(customerId, ownerId, customerTemplate, ownerTemplate) {
  await Promise.allSettled([
    customerId && customerTemplate ? notifyUser(customerId, customerTemplate) : Promise.resolve(),
    ownerId    && ownerTemplate    ? notifyUser(ownerId,    ownerTemplate)    : Promise.resolve(),
  ]);
}

module.exports = { notifyUser, notifyUsers, notifyBoth, TEMPLATES };
