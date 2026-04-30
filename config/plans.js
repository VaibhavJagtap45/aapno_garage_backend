// config/plans.js
// ─────────────────────────────────────────────────────────────────────────────
//  Shared garage plan definitions.
//
//  This file keeps the in-memory plan catalog used by middleware in sync with
//  the database-backed catalog. A small alias layer keeps older "starter/pro"
//  legacy plan aliases working while the new "basic/franchise/premium" tiers roll out.
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_ALIASES = {
  starter: "basic",
  pro: "premium",
};

const DEFAULT_BILLING_PLANS = {
  free: {
    slug: "free",
    name: "Free",
    description: "Lightweight access for a single garage.",
    price: { monthly: 0, yearly: 0 },
    garageLimit: 1,
    limits: {
      maxRepairOrders: 20,
      maxInvoices: 20,
      maxMembers: 1,
      maxCustomers: 50,
      maxVendors: 5,
      maxStorageMB: 100,
    },
    features: ["basic_reports", "tally_export"],
    badge: "Trial",
    accent: "#75808f",
    recommended: false,
    isActive: true,
    isHidden: false,
    sortOrder: 0,
  },

  basic: {
    slug: "basic",
    name: "Basic",
    description: "Core billing and customer management for a single garage.",
    price: { monthly: 999, yearly: 9990 },
    garageLimit: 1,
    limits: {
      maxRepairOrders: 200,
      maxInvoices: 200,
      maxMembers: 3,
      maxCustomers: 300,
      maxVendors: 10,
      maxStorageMB: 1024,
    },
    features: [
      "basic_reports",
      "all_reports",
      "tally_export",
      "service_reminders",
      "push_notifications",
    ],
    badge: "Starter",
    accent: "#1f7a5c",
    recommended: false,
    isActive: true,
    isHidden: false,
    sortOrder: 1,
  },

  franchise: {
    slug: "franchise",
    name: "Franchise",
    description: "Built for growing groups with up to three garages.",
    price: { monthly: 2499, yearly: 24990 },
    garageLimit: 3,
    limits: {
      maxRepairOrders: 600,
      maxInvoices: 600,
      maxMembers: 10,
      maxCustomers: 1200,
      maxVendors: 30,
      maxStorageMB: 3072,
    },
    features: [
      "basic_reports",
      "all_reports",
      "tally_export",
      "service_reminders",
      "push_notifications",
      "purchase_orders",
      "inventory_transfer",
      "multi_garage_dashboard",
    ],
    badge: "Popular",
    accent: "#205d70",
    recommended: true,
    isActive: true,
    isHidden: false,
    sortOrder: 2,
  },

  premium: {
    slug: "premium",
    name: "Premium",
    description: "Advanced scale plan for franchises running up to seven garages.",
    price: { monthly: 4999, yearly: 49990 },
    garageLimit: 7,
    limits: {
      maxRepairOrders: -1,
      maxInvoices: -1,
      maxMembers: -1,
      maxCustomers: -1,
      maxVendors: -1,
      maxStorageMB: 10240,
    },
    features: [
      "basic_reports",
      "all_reports",
      "tally_export",
      "service_reminders",
      "push_notifications",
      "purchase_orders",
      "inventory_transfer",
      "multi_garage_dashboard",
      "inventory_alerts",
      "custom_tags",
      "priority_support",
    ],
    badge: "Top tier",
    accent: "#7a4c1f",
    recommended: false,
    isActive: true,
    isHidden: false,
    sortOrder: 3,
  },
};

const TRIAL_DURATION_DAYS = 14;
const TRIAL_PLAN = "basic";

// Mutable in-memory catalog consumed by middleware and controllers.
const PLANS = {};

const clonePlan = (plan) => ({
  ...plan,
  price: { ...(plan.price || {}) },
  limits: { ...(plan.limits || {}) },
  features: [...(plan.features || [])],
});

const normalizePlanSlug = (slug) => {
  if (!slug) return slug;
  const value = String(slug).trim().toLowerCase();
  return PLAN_ALIASES[value] || value;
};

const buildPlanCatalog = (plans = DEFAULT_BILLING_PLANS) => {
  const nextCatalog = {};

  Object.values(plans).forEach((plan) => {
    if (!plan?.slug) return;
    const canonical = normalizePlanSlug(plan.slug);
    nextCatalog[canonical] = clonePlan({ ...plan, slug: canonical });
  });

  Object.entries(PLAN_ALIASES).forEach(([legacySlug, canonicalSlug]) => {
    if (nextCatalog[canonicalSlug]) {
      nextCatalog[legacySlug] = nextCatalog[canonicalSlug];
    }
  });

  return nextCatalog;
};

const syncPlanCatalog = (plans) => {
  const nextCatalog = buildPlanCatalog(plans);
  Object.keys(PLANS).forEach((key) => delete PLANS[key]);
  Object.entries(nextCatalog).forEach(([slug, plan]) => {
    PLANS[slug] = plan;
  });
  return PLANS;
};

syncPlanCatalog(DEFAULT_BILLING_PLANS);

const getPlan = (slug) => {
  const normalized = normalizePlanSlug(slug);
  return normalized ? PLANS[normalized] ?? null : null;
};

const listPlans = () => {
  const seen = new Set();
  return Object.values(PLANS).filter((plan) => {
    if (!plan?.slug) return false;
    if (seen.has(plan.slug)) return false;
    seen.add(plan.slug);
    return true;
  });
};

const planHasFeature = (slug, feature) => {
  const plan = getPlan(slug);
  return plan ? plan.features.includes(feature) : false;
};

const getPlanLimit = (slug, limitKey) => {
  const plan = getPlan(slug);
  if (!plan) return 0;
  if (limitKey === "garageLimit") return plan.garageLimit ?? 0;
  return plan.limits?.[limitKey] ?? 0;
};

const getPlanPrice = (slug, cycle = "monthly") => {
  const plan = getPlan(slug);
  if (!plan) return 0;
  return plan.price?.[cycle] ?? 0;
};

module.exports = {
  PLAN_ALIASES,
  DEFAULT_BILLING_PLANS,
  PLANS,
  TRIAL_DURATION_DAYS,
  TRIAL_PLAN,
  normalizePlanSlug,
  buildPlanCatalog,
  syncPlanCatalog,
  listPlans,
  getPlan,
  planHasFeature,
  getPlanLimit,
  getPlanPrice,
};
