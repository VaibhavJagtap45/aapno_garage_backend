// services/repairOrderNotification.service.js
// ─────────────────────────────────────────────────────────────────
//  Side-effects for repair-order lifecycle events. Extracted from
//  RepairOrder.controller.js so the controller stays focused on
//  request → DB → response and isn't doing notification dispatch
//  inline. All functions are fire-and-forget: they catch their own
//  errors and never bubble, so an SMS/Push outage can't break the
//  primary write.
// ─────────────────────────────────────────────────────────────────

const Garage = require("../models/Garage.model");
const User = require("../models/User.model");
const {
  notifyBoth,
  TEMPLATES,
} = require("./pushNotification.service");
const { sendWhatsApp } = require("../utils/whatsapp");

// Status → push templates. Adding a new transition? Add a row here
// rather than another `if (status === ...)` branch in the controller.
const STATUS_PUSH = {
  in_progress: ({ orderNo }) => ({
    customer: TEMPLATES.REPAIR_STARTED(orderNo),
    owner: TEMPLATES.OWNER_REPAIR_STARTED(orderNo),
  }),
  vehicle_ready: ({ orderNo, garageName }) => ({
    customer: TEMPLATES.VEHICLE_READY(orderNo, garageName),
    owner: TEMPLATES.OWNER_VEHICLE_READY(orderNo, "Customer"),
  }),
  completed: ({ orderNo }) => ({
    customer: TEMPLATES.REPAIR_COMPLETED(orderNo),
    owner: TEMPLATES.OWNER_REPAIR_COMPLETED(orderNo),
  }),
};

function buildReadyForPickupWhatsApp({ customerName, garageName, orderNo }) {
  const roNo = orderNo ?? "your repair order";
  return (
    `Hi ${customerName}! 🚗\n\n` +
    `Your vehicle is ready for pickup at *${garageName}*.\n` +
    `Repair Order: *${roNo}*\n\n` +
    `Please visit us at your earliest convenience. Thank you!`
  );
}

// Fire-and-forget. Logs internally; never throws.
async function notifyStatusTransition({ garageId, order, status }) {
  try {
    const [garage, customer] = await Promise.all([
      Garage.findById(garageId)
        .select("owner preferences garageName")
        .lean(),
      order.customerId
        ? User.findById(order.customerId).select("fullName phoneNo").lean()
        : null,
    ]);

    const ownerId = garage?.owner;
    const garageName = garage?.garageName ?? "your garage";
    const customerName = customer?.fullName || "Customer";
    const orderNo = order.orderNo;

    const templateFactory = STATUS_PUSH[status];
    if (templateFactory) {
      const { customer: cTpl, owner: oTpl } = templateFactory({
        orderNo,
        garageName,
        customerName,
      });
      await notifyBoth(order.customerId, ownerId, cTpl, oTpl);
    }

    if (
      status === "vehicle_ready" &&
      garage?.preferences?.autoWaNotification &&
      customer?.phoneNo
    ) {
      await sendWhatsApp(
        customer.phoneNo,
        buildReadyForPickupWhatsApp({ customerName, garageName, orderNo }),
      );
    }
  } catch (err) {
    console.error(
      "[Push] Repair-order status transition notification failed:",
      err.message,
    );
  }
}

// Notify customer + owner that a brand-new repair order was created.
// Fire-and-forget. Same error semantics as notifyStatusTransition.
async function notifyOrderCreated({ garageId, order }) {
  try {
    const [garage, customer] = await Promise.all([
      Garage.findById(garageId).select("owner").lean(),
      order.customerId
        ? User.findById(order.customerId).select("fullName").lean()
        : null,
    ]);
    await notifyBoth(
      order.customerId,
      garage?.owner,
      TEMPLATES.REPAIR_ORDER_CREATED(order.orderNo),
      TEMPLATES.OWNER_ORDER_CREATED(order.orderNo, customer?.fullName),
    );
  } catch (err) {
    console.error(
      "[Push] Repair-order created notification failed:",
      err.message,
    );
  }
}

module.exports = {
  notifyStatusTransition,
  notifyOrderCreated,
};
