// controllers/analytics.controller.js

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response.utils");
const analyticsService = require("../services/analytics.service");

const getAnalytics = asyncHandler(async (req, res) => {
  const data = await analyticsService.getAnalytics({
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
    franchiseId: req.query.franchiseId,
    garageId: req.query.garageId,
  });
  return sendSuccess(res, 200, "Analytics fetched", data);
});

const getAnalyticsMeta = asyncHandler(async (_req, res) => {
  const data = await analyticsService.getMeta();
  return sendSuccess(res, 200, "Filters fetched", data);
});

module.exports = { getAnalytics, getAnalyticsMeta };
