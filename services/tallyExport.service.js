// services/tallyExport.service.js
// Admin-level Tally export: aggregates bookings + invoices across garages/franchises
// and returns structured data suitable for CSV/Excel export.

const mongoose = require("mongoose");
const Invoice = require("../models/Invoice.model");
const Garage = require("../models/Garage.model");
const User = require("../models/User.model");
const Booking = require("../models/Booking.model");
const { BadRequestError } = require("../core/errors");

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestError(`Invalid date '${v}'.`);
  return d;
}

async function getTallyExportData({ dateFrom, dateTo, franchiseId, garageId } = {}) {
  const from = toDate(dateFrom);
  const to = toDate(dateTo);
  if (!from || !to) throw new BadRequestError("dateFrom and dateTo are required.");
  if (from > to) throw new BadRequestError("dateFrom must be before dateTo.");

  to.setHours(23, 59, 59, 999);

  let garageIds = null;
  if (garageId) {
    garageIds = [new mongoose.Types.ObjectId(garageId)];
  } else if (franchiseId) {
    const garages = await Garage.find({ franchiseId }).select("_id").lean();
    garageIds = garages.map((g) => g._id);
  }

  const invoiceMatch = { createdAt: { $gte: from, $lte: to }, isDeleted: false };
  if (garageIds) invoiceMatch.garageId = { $in: garageIds };

  const invoices = await Invoice.find(invoiceMatch)
    .populate("garageId", "garageName garageOwnerName isGstApplicable gstNumber")
    .populate("customerId", "fullName phoneNo")
    .sort({ createdAt: 1 })
    .lean();

  const rows = invoices.map((inv) => {
    const garage = inv.garageId || {};
    const serviceAmount = (inv.servicesSubTotal || 0) + (inv.partsSubTotal || 0) + (inv.labourCharge || 0);
    const gst = garage.isGstApplicable ? (inv.taxAmount || 0) : 0;

    return {
      date: inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("en-IN") : "",
      invoiceNo: inv.invoiceNo || "",
      garageName: garage.garageName || "",
      ownerName: garage.garageOwnerName || "",
      customerName: inv.customerId?.fullName || "",
      customerPhone: inv.customerId?.phoneNo || "",
      serviceAmount: Number(serviceAmount.toFixed(2)),
      discount: Number((inv.discountAmount || 0).toFixed(2)),
      gst: Number(gst.toFixed(2)),
      totalAmount: Number((inv.totalAmount || 0).toFixed(2)),
      paidAmount: Number((inv.paidAmount || 0).toFixed(2)),
      paymentStatus: inv.paymentStatus || "unpaid",
      paymentMode: inv.paymentMode || "cash",
    };
  });

  return { rows, total: rows.length, dateFrom, dateTo };
}

function toCSV(rows) {
  const headers = [
    "Date",
    "Invoice No",
    "Garage",
    "Owner",
    "Customer",
    "Customer Phone",
    "Service Amount",
    "Discount",
    "GST",
    "Total Amount",
    "Paid Amount",
    "Payment Status",
    "Payment Mode",
  ];

  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.invoiceNo,
        r.garageName,
        r.ownerName,
        r.customerName,
        r.customerPhone,
        r.serviceAmount,
        r.discount,
        r.gst,
        r.totalAmount,
        r.paidAmount,
        r.paymentStatus,
        r.paymentMode,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

module.exports = { getTallyExportData, toCSV };
