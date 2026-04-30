const { z } = require("zod");

// ─── Reusable field definitions ───────────────────────────────────

const phoneNoField = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number");

const emailField = z
  .string()
  .email("Invalid email format")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v === "" ? undefined : v));

const passwordField = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(100, "Password is too long");

// ─── Schema: Register ─────────────────────────────────────────────
const registerSchema = z.object({
  phoneNo: phoneNoField,
});

// ─── Schema: Login ────────────────────────────────────────────────
const loginSchema = z.object({
  phoneNo: phoneNoField,
  password: z.string().min(1, "Password is required"),
});

// ─── Schema: Change Password ──────────────────────────────────────
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

// ─── Schema: Complete Garage Profile ─────────────────────────────
//
//  isGstApplicable can arrive as a boolean (JSON) or the strings
//  "true"/"false" (FormData) — both are handled via the preprocess.
// ─────────────────────────────────────────────────────────────────
const garageProfileSchema = z
  .object({
    // ── User-level fields ──────────────────────────────────────
    fullName: z.string().min(2, "Min 2 characters").max(50).trim().optional(),
    emailId: emailField,
    state: z.string().trim().optional(),

    // ── Garage-level fields ────────────────────────────────────
    garageName: z.string().min(2, "Min 2 characters").max(100).trim(),
    garageOwnerName: z.string().min(2, "Min 2 characters").max(100).trim(),
    garageAddress: z.string().min(5, "Min 5 characters").max(300).trim(),
    garageContactNumber: z
      .string()
      .regex(/^[6-9]\d{9}$/, "Invalid contact number"),
    garageType: z.enum(["twoWheeler", "fourWheeler", "both"], {
      errorMap: () => ({ message: "Must be twoWheeler or fourWheeler" }),
    }),
    garageLogo: z
      .string()
      .refine(
        (v) => /^https?:\/\/.+/.test(v) || /^data:image\/.+;base64,/.test(v),
        { message: "Garage logo must be a valid URL or base64 data image" },
      )
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" ? undefined : v)),

    // ── GST — coerce FormData strings to boolean ───────────────
    isGstApplicable: z.preprocess((v) => {
      if (typeof v === "boolean") return v;
      if (v === "true") return true;
      if (v === "false") return false;
      return false;
    }, z.boolean().default(false)),
    gstNumber: z
      .string()
      .regex(
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        "Invalid GST number format",
      )
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine((data) => !data.isGstApplicable || !!data.gstNumber, {
    message: "GST number is required when GST is applicable",
    path: ["gstNumber"],
  });

// ─── Schema: Add User  (POST /api/user/add-user) ─────────────────
const addUserSchema = z
  .object({
    phoneNo: phoneNoField.optional(),
    emailId: z
      .string()
      .email("Invalid email format")
      .toLowerCase()
      .trim()
      .optional(),
    fullName: z.string().min(2, "Min 2 characters").max(100).trim().optional(),
    address: z.string().trim().optional(),
    role: z.enum(["customer", "member", "vendor", "manager"], {
      errorMap: () => ({
        message: "Role must be one of: customer, member, vendor, manager",
      }),
    }),

    // ── Vehicle fields (only used when role === customer) ──────
    vehicleBrand: z.string().trim().optional(),
    vehicleModel: z.string().trim().optional(),
    vehicleRegisterNo: z.string().trim().toUpperCase().optional(),
    vehiclePurchaseDate: z.string().datetime().optional(),
    vehicleEngineNo: z.string().trim().optional(),
    vehicleVinNo: z.string().trim().optional(),
    vehicleInsuranceProvider: z.string().trim().optional(),
    vehiclePolicyNo: z.string().trim().optional(),
    vehicleInsuranceExpire: z.string().datetime().optional(),
    vehicleRegCertificate: z.string().trim().optional(),
    vehicleInsuranceDoc: z.string().trim().optional(),
  })
  .refine((data) => data.phoneNo || data.emailId, {
    message: "At least one of phoneNo or emailId is required",
    path: ["phoneNo"],
  })
  .refine(
    (data) => {
      const hasAnyVehicleField = [
        data.vehicleBrand,
        data.vehicleModel,
        data.vehicleRegisterNo,
      ].some(Boolean);

      if (data.role === "customer" && hasAnyVehicleField) {
        return data.vehicleBrand && data.vehicleModel;
      }
      return true;
    },
    {
      message:
        "vehicleBrand and vehicleModel are required when adding a vehicle",
      path: ["vehicleBrand"],
    },
  );

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  garageProfileSchema,
  addUserSchema,
};
