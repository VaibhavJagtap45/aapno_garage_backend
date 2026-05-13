const dotenv = require("dotenv");
dotenv.config();
require("dns").setDefaultResultOrder("ipv4first");
const path = require("path");
const express = require("express");
const cors = require("cors"); // localhost:3000 & lacalhost :5000
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { connectDB } = require("./config/dbConnect");
const AuthRoutes = require("./routes/auth.routes");
const UserRoutes = require("./routes/user.routes");
const UserListRoutes = require("./routes/Userlist.routes");
const VehicleRoutes = require("./routes/vehicle.routes");
const ServicePartsCatalogRoutes = require("./routes/servicePartsCatalog.routes");
const GarageServiceRoutes = require("./routes/Garageservice.routes");
const RepairOrderRoutes = require("./routes/repairOrder.routes");
const PurchaseOrderRoutes = require("./routes/PurchaseOrder.routes");
const InvoiceRoutes = require("./routes/invoice.routes");
const TagRoutes = require("./routes/tag.routes");
const ServiceReminderRoutes = require("./routes/serviceReminder.routes");
const FeedbackRoutes = require("./routes/feedback.routes");
const StockInRoutes = require("./routes/stockIn.routes");
const ExpenseRoutes = require("./routes/expense.routes");
const CustomerRoutes = require("./routes/customer.routes");
const MemberRoutes = require("./routes/member.routes");
const AdminRoutes = require("./routes/admin.routes");
const AdminInvoiceRoutes = require("./routes/adminInvoice.routes");
const AdminRepairOrderRoutes = require("./routes/adminRepairOrder.routes");
const BookingRoutes = require("./routes/booking.routes");
const ReportsRoutes = require("./routes/reports.routes");
const FranchiseRoutes = require("./routes/franchise.routes");
const InventoryTransferRoutes = require("./routes/inventoryTransfer.routes");
const { stampFranchiseOnServices } = require("./utils/stampFranchiseOnServices");
// const VehicleMetaRoutes = require("./routes/vehicleMeta.routes");
const app = express(); //express js
const PORT = process.env.PORT || 5000;

// ── Security headers ───────────────────────────────────────────────
app.use(helmet());

// ── Global rate limit — 100 req / 15 min per IP ───────────────────
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// ── CORS ───────────────────────────────────────────────────────────
const allowedOrigins =
  process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? [];
const localDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const privateLanDevOrigin =
  /^https?:\/\/(10(?:\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(:\d+)?$/i;

app.use(
  cors({
    origin: (origin, callback) => {
      // No origin = same-origin / mobile app / server-to-server — allow
      if (!origin) return callback(null, true);
      // In development, allow any localhost port (Vite dev server, admin panel, etc.)
      if (
        process.env.NODE_ENV === "development" &&
        (localDevOrigin.test(origin) || privateLanDevOrigin.test(origin))
      ) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// ── Body parsers ───────────────────────────────────────────────────
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" })); // FormData support
app.use(cookieParser());

// ── Static uploads ─────────────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Health check ───────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.json({ message: "Garage System Backend is running 🎉" }),
);

// ── API Routes ─────────────────────────────────────────────────────
const API_VERSION = process.env.BACKEND_VERSION ?? "v1";
app.use(`/api/${API_VERSION}/auth`, AuthRoutes);
app.use(`/api/${API_VERSION}/admin/invoices`, AdminInvoiceRoutes); // before generic AdminRoutes
app.use(`/api/${API_VERSION}/admin/repair-orders`, AdminRepairOrderRoutes);
app.use(`/api/${API_VERSION}/admin`, AdminRoutes); // must be before UserListRoutes (no-prefix catch-all)
app.use(`/api/${API_VERSION}/user`, UserRoutes);
app.use(`/api/${API_VERSION}/vehicle`, VehicleRoutes);
app.use(`/api/${API_VERSION}/catalog`, ServicePartsCatalogRoutes);
app.use(`/api/${API_VERSION}`, UserListRoutes);
app.use(`/api/${API_VERSION}/garage-services`, GarageServiceRoutes);
app.use(`/api/${API_VERSION}/repair-orders`, RepairOrderRoutes);
app.use(`/api/${API_VERSION}/purchase-orders`, PurchaseOrderRoutes);
app.use(`/api/${API_VERSION}/invoices`, InvoiceRoutes);
app.use(`/api/${API_VERSION}/tags`, TagRoutes);
app.use(`/api/${API_VERSION}/service-reminders`, ServiceReminderRoutes);
app.use(`/api/${API_VERSION}/feedbacks`, FeedbackRoutes);
app.use(`/api/${API_VERSION}/stock-in`, StockInRoutes);
app.use(`/api/${API_VERSION}/expenses`, ExpenseRoutes);
app.use(`/api/${API_VERSION}/customer`, CustomerRoutes);
app.use(`/api/${API_VERSION}/member`, MemberRoutes);
app.use(`/api/${API_VERSION}/bookings`, BookingRoutes);
app.use(`/api/${API_VERSION}/reports`, ReportsRoutes);
app.use(`/api/${API_VERSION}/franchises`, FranchiseRoutes);
app.use(`/api/${API_VERSION}/inventory-transfers`, InventoryTransferRoutes);
// ── 404 handler ────────────────────────────────────────────────────
app.use((_req, res) =>
  res.status(404).json({ success: false, message: "Route not found." }),
);

// ── Global error handler ────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];
    const value = field ? err.keyValue?.[field] : undefined;
    const message =
      field && value !== undefined
        ? `${field} '${value}' already exists.`
        : "A record with the same unique value already exists.";

    console.warn("Duplicate key error:", {
      collection: err?.message?.match(/collection:\s+([^\s]+)/)?.[1] || null,
      field,
      value,
    });

    return res.status(409).json({ success: false, message });
  }

  console.error(err.stack);
  res
    .status(err.status || 500)
    .json({ success: false, message: err.message || "Internal Server Error" });
});

// ── Bootstrap ──────────────────────────────────────────────────────
connectDB()
  .then(async () => {
    await stampFranchiseOnServices();
    app.listen(PORT, () =>
      console.log(`Server running on PORT ${PORT} [${process.env.NODE_ENV}]`),
    );
  })
  .catch((err) => {
    console.error("DB connection failed:", err);
    process.exit(1);
  });

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});
