const Booking = require("../models/Booking.model");
const Garage = require("../models/Garage.model");
const User = require("../models/User.model");
const RepairOrder = require("../models/RepairOrder.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const { notifyUser, TEMPLATES } = require("../services/pushNotification.service");

async function ownerGarage(userId) {
  return Garage.findOne({ owner: userId }).lean();
}

function populateBooking(query) {
  return query
    .populate("customer", "fullName phoneNo emailId")
    .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo");
}

const listBookings = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const garage = await ownerGarage(req.user._id);
  if (!garage) {
    return sendSuccess(res, 200, "Bookings fetched.", { total: 0, bookings: [] });
  }

  const { status, date, search, page = 1, limit = 20 } = req.query;
  const filter = { garage: garage._id };

  if (status && status !== "all") {
    filter.status = status;
  }

  if (date) {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    filter.scheduledAt = { $gte: start, $lte: end };
  }

  if (search) {
    const users = await User.find({
      garage: garage._id,
      $or: [
        { fullName: { $regex: search, $options: "i" } },
        { phoneNo: { $regex: search, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();
    filter.customer = { $in: users.map((user) => user._id) };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [total, bookings] = await Promise.all([
    Booking.countDocuments(filter),
    Booking.find(filter)
      .sort({ scheduledAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("customer", "fullName phoneNo emailId")
      .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo")
      .lean(),
  ]);

  return sendSuccess(res, 200, "Bookings fetched.", { total, bookings });
});

const createBooking = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const garage = await ownerGarage(req.user._id);
  if (!garage) {
    return sendError(res, 404, "Garage not found.");
  }

  const { customerId, vehicleId, scheduledAt, duration, serviceType, notes } = req.body;

  if (!customerId) {
    return sendError(res, 400, "customerId is required.");
  }
  if (!scheduledAt) {
    return sendError(res, 400, "scheduledAt is required.");
  }

  const customer = await User.findById(customerId).lean();
  if (!customer || String(customer.garage) !== String(garage._id)) {
    return sendError(res, 404, "Customer not found in your garage.");
  }

  const booking = await Booking.create({
    garage: garage._id,
    customer: customerId,
    ...(vehicleId && { vehicle: vehicleId }),
    scheduledAt: new Date(scheduledAt),
    ...(duration && { duration: Number(duration) }),
    serviceType: serviceType || "",
    notes: notes || "",
    bookedBy: "owner",
    status: "confirmed",
  });

  const populated = await Booking.findById(booking._id)
    .populate("customer", "fullName phoneNo emailId")
    .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo")
    .lean();

  (async () => {
    try {
      await notifyUser(customerId, TEMPLATES.BOOKING_CONFIRMED(booking.bookingNo));
    } catch (err) {
      console.error("[Push] Booking confirmed notification failed:", err.message);
    }
  })();

  return sendSuccess(res, 201, "Booking created.", {
    booking: populated,
  });
});

const getBookingDetail = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const garage = await ownerGarage(req.user._id);
  const booking = await Booking.findOne({ _id: req.params.id, garage: garage?._id })
    .populate("customer", "fullName phoneNo emailId")
    .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo")
    .populate("repairOrderId", "orderNo status")
    .lean();

  if (!booking) {
    return sendError(res, 404, "Booking not found.");
  }

  return sendSuccess(res, 200, "Booking fetched.", { booking });
});

const updateBookingStatus = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const { status } = req.body;
  const allowed = ["pending", "confirmed", "in_progress", "completed", "cancelled"];
  if (!status || !allowed.includes(status)) {
    return sendError(res, 400, `status must be one of: ${allowed.join(", ")}`);
  }

  const garage = await ownerGarage(req.user._id);
  if (!garage) {
    return sendError(res, 404, "Garage not found.");
  }

  const existing = await Booking.findOne({
    _id: req.params.id,
    garage: garage._id,
  }).lean();

  if (!existing) {
    return sendError(res, 404, "Booking not found.");
  }

  const booking = await populateBooking(
    Booking.findByIdAndUpdate(existing._id, { status }, { returnDocument: "after" }),
  ).lean();

  return sendSuccess(res, 200, "Booking status updated.", { booking });
});

const convertToRepairOrder = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const garage = await ownerGarage(req.user._id);
  const booking = await Booking.findOne({
    _id: req.params.id,
    garage: garage?._id,
  }).lean();

  if (!booking) {
    return sendError(res, 404, "Booking not found.");
  }
  if (booking.repairOrderId) {
    return sendError(res, 400, "This booking already has a repair order.");
  }
  if (!booking.vehicle) {
    return sendError(res, 400, "Booking must have a vehicle to convert to repair order.");
  }

  const ro = await RepairOrder.create({
    garageId: garage._id,
    customerId: booking.customer,
    vehicleId: booking.vehicle,
    customerNote: booking.notes || booking.serviceType || "",
    createdBy: req.user._id,
    status: "created",
  });

  await Booking.findByIdAndUpdate(booking._id, {
    repairOrderId: ro._id,
    status: "in_progress",
  });

  return sendSuccess(res, 201, "Repair order created from booking.", {
    repairOrderId: ro._id,
    orderNo: ro.orderNo,
  });
});

const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ customer: req.user._id })
    .sort({ scheduledAt: -1 })
    .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo")
    .lean();

  return sendSuccess(res, 200, "Bookings fetched.", {
    total: bookings.length,
    bookings,
  });
});

const createMyBooking = asyncHandler(async (req, res) => {
  const { vehicleId, scheduledAt, serviceType, notes } = req.body;

  if (!scheduledAt) {
    return sendError(res, 400, "scheduledAt is required.");
  }
  if (!serviceType) {
    return sendError(res, 400, "serviceType is required.");
  }

  const garage = await Garage.findById(req.user.garage).lean();
  if (!garage) {
    return sendError(res, 404, "Garage not found.");
  }

  const booking = await Booking.create({
    garage: garage._id,
    customer: req.user._id,
    ...(vehicleId && { vehicle: vehicleId }),
    scheduledAt: new Date(scheduledAt),
    serviceType,
    notes: notes || "",
    bookedBy: "customer",
    status: "pending",
  });

  const populated = await Booking.findById(booking._id)
    .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo")
    .lean();

  return sendSuccess(res, 201, "Booking request sent.", { booking: populated });
});

const cancelMyBooking = asyncHandler(async (req, res) => {
  const existing = await Booking.findOne({
    _id: req.params.id,
    customer: req.user._id,
    status: { $in: ["pending", "confirmed"] },
  }).lean();

  if (!existing) {
    return sendError(res, 404, "Booking not found or cannot be cancelled.");
  }

  const booking = await Booking.findByIdAndUpdate(
    existing._id,
    { status: "cancelled" },
    { returnDocument: "after" },
  ).lean();

  return sendSuccess(res, 200, "Booking cancelled.", { booking });
});

const linkRepairOrder = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const { repairOrderId } = req.body;
  if (!repairOrderId) {
    return sendError(res, 400, "repairOrderId is required.");
  }

  const garage = await ownerGarage(req.user._id);
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, garage: garage?._id },
    { repairOrderId, status: "in_progress" },
    { returnDocument: "after" },
  )
    .populate("customer", "fullName phoneNo emailId")
    .populate("vehicle", "vehicleBrand vehicleModel vehicleRegisterNo")
    .populate("repairOrderId", "orderNo status")
    .lean();

  if (!booking) {
    return sendError(res, 404, "Booking not found.");
  }

  return sendSuccess(res, 200, "Repair order linked to booking.", { booking });
});

module.exports = {
  listBookings,
  createBooking,
  getBookingDetail,
  updateBookingStatus,
  convertToRepairOrder,
  linkRepairOrder,
  getMyBookings,
  createMyBooking,
  cancelMyBooking,
};
