const mongoose = require("mongoose");
const InventoryTransfer = require("../models/InventoryTransfer.model");
const Inventory = require("../models/Inventry.model");
const Garage = require("../models/Garage.model");
const Franchise = require("../models/Franchise.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendError, sendSuccess } = require("../utils/response.utils");
const resolveGarageContext = require("../utils/resolveGarageContext");

const canManageTransfers = (role) => ["owner", "manager", "franchiseOwner"].includes(role);

const listTransfers = asyncHandler(async (req, res) => {
  const context = await resolveGarageContext(req.user);
  if (!context?.franchiseId) return sendSuccess(res, 200, "No franchise context", { transfers: [] });

  const transfers = await InventoryTransfer.find({
    franchiseId: context.franchiseId,
    $or: [{ fromGarageId: context.garageId }, { toGarageId: context.garageId }],
  })
    .populate("fromGarageId", "garageName")
    .populate("toGarageId", "garageName")
    .populate("requestedBy", "fullName role")
    .populate("counterpartyApprovedBy", "fullName role")
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(res, 200, "Inventory transfers fetched", { transfers });
});

const createTransfer = asyncHandler(async (req, res) => {
  if (!canManageTransfers(req.user.role)) {
    return sendError(res, 403, "Only owner/manager can request inventory transfers.");
  }

  const context = await resolveGarageContext(req.user);
  if (!context?.franchiseId) return sendError(res, 400, "Your garage is not part of a franchise.");

  const franchise = await Franchise.findById(context.franchiseId).lean();
  if (!franchise?.sharingPolicy?.allowInventoryTransfer) {
    return sendError(res, 403, "Inventory transfer is disabled for this franchise.");
  }

  const { toGarageId, fromGarageId, requestType = "send", items = [], notes } = req.body;
  const sourceGarageId = fromGarageId || context.garageId;
  const targetGarageId = toGarageId;
  if (!targetGarageId) return sendError(res, 400, "toGarageId is required.");
  if (String(sourceGarageId) === String(targetGarageId)) {
    return sendError(res, 400, "Cannot transfer inventory within the same garage.");
  }
  if (!Array.isArray(items) || !items.length) return sendError(res, 400, "At least one transfer item is required.");

  const [sourceGarage, targetGarage] = await Promise.all([
    Garage.findById(sourceGarageId).lean(),
    Garage.findById(targetGarageId).lean(),
  ]);
  if (!sourceGarage || !targetGarage) return sendError(res, 404, "Source or target garage not found.");
  if (String(sourceGarage.franchiseId) !== String(context.franchiseId) || String(targetGarage.franchiseId) !== String(context.franchiseId)) {
    return sendError(res, 400, "Both garages must belong to the same franchise.");
  }

  const transfer = await InventoryTransfer.create({
    franchiseId: context.franchiseId,
    fromGarageId: sourceGarageId,
    toGarageId: targetGarageId,
    requestedBy: req.user._id,
    requestType,
    items,
    notes: notes || null,
  });

  return sendSuccess(res, 201, "Inventory transfer request created", { transfer });
});

const approveTransfer = asyncHandler(async (req, res) => {
  if (!canManageTransfers(req.user.role)) {
    return sendError(res, 403, "Only owner/manager can approve transfers.");
  }
  const context = await resolveGarageContext(req.user);
  const transfer = await InventoryTransfer.findById(req.params.id);
  if (!transfer) return sendError(res, 404, "Transfer not found.");
  if (transfer.status !== "pending_approval") return sendError(res, 400, "Only pending requests can be approved.");
  if (!context || (String(transfer.toGarageId) !== String(context.garageId) && String(transfer.fromGarageId) !== String(context.garageId))) {
    return sendError(res, 403, "You can approve only transfers involving your garage.");
  }

  transfer.status = "approved";
  transfer.approvedAt = new Date();
  transfer.counterpartyApprovedBy = req.user._id;
  await transfer.save();

  return sendSuccess(res, 200, "Transfer approved", { transfer });
});

const markInTransit = asyncHandler(async (req, res) => {
  const context = await resolveGarageContext(req.user);
  const transfer = await InventoryTransfer.findById(req.params.id);
  if (!transfer) return sendError(res, 404, "Transfer not found.");
  if (transfer.status !== "approved") return sendError(res, 400, "Only approved transfers can move in transit.");
  if (!context || String(transfer.fromGarageId) !== String(context.garageId)) {
    return sendError(res, 403, "Only sender garage can mark transfer in transit.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    for (const item of transfer.items) {
      const inv = await Inventory.findOne({ _id: item.inventoryId, garageId: transfer.fromGarageId }).session(session);
      if (!inv) throw new Error(`Source inventory item not found: ${item.partName}`);
      if (inv.quantityInHand < item.quantity) throw new Error(`Insufficient stock for ${item.partName}`);
      inv.quantityInHand -= item.quantity;
      await inv.save({ session });
    }
    transfer.status = "in_transit";
    transfer.inTransitAt = new Date();
    await transfer.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    return sendError(res, 400, error.message);
  } finally {
    session.endSession();
  }

  return sendSuccess(res, 200, "Transfer marked in transit", { transfer });
});

const receiveTransfer = asyncHandler(async (req, res) => {
  const context = await resolveGarageContext(req.user);
  const transfer = await InventoryTransfer.findById(req.params.id);
  if (!transfer) return sendError(res, 404, "Transfer not found.");
  if (transfer.status !== "in_transit") return sendError(res, 400, "Only in-transit transfer can be received.");
  if (!context || String(transfer.toGarageId) !== String(context.garageId)) {
    return sendError(res, 403, "Only receiver garage can mark transfer received.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    for (const item of transfer.items) {
      const existing = await Inventory.findOne({
        garageId: transfer.toGarageId,
        partName: item.partName,
        partCode: item.partCode || null,
        isActive: true,
      }).session(session);

      if (existing) {
        existing.quantityInHand += item.quantity;
        await existing.save({ session });
      } else {
        await Inventory.create(
          [
            {
              garageId: transfer.toGarageId,
              partName: item.partName,
              partCode: item.partCode || null,
              category: "general",
              quantityInHand: item.quantity,
              minimumStockLevel: 1,
              purchasePrice: item.unitPrice,
              sellingPrice: item.unitPrice,
            },
          ],
          { session },
        );
      }
    }
    transfer.status = "received";
    transfer.receivedAt = new Date();
    await transfer.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    return sendError(res, 400, error.message);
  } finally {
    session.endSession();
  }

  return sendSuccess(res, 200, "Transfer received", { transfer });
});

const rejectTransfer = asyncHandler(async (req, res) => {
  const transfer = await InventoryTransfer.findById(req.params.id);
  if (!transfer) return sendError(res, 404, "Transfer not found.");
  if (transfer.status !== "pending_approval") return sendError(res, 400, "Only pending requests can be rejected.");
  transfer.status = "rejected";
  transfer.rejectedAt = new Date();
  transfer.counterpartyApprovedBy = req.user._id;
  await transfer.save();
  return sendSuccess(res, 200, "Transfer rejected", { transfer });
});

module.exports = {
  listTransfers,
  createTransfer,
  approveTransfer,
  markInTransit,
  receiveTransfer,
  rejectTransfer,
};
