// controllers/tallyExport.controller.js

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response.utils");
const { getTallyExportData, toCSV } = require("../services/tallyExport.service");

const tallyExportJSON = asyncHandler(async (req, res) => {
  const data = await getTallyExportData({
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    franchiseId: req.query.franchiseId,
    garageId: req.query.garageId,
  });
  return sendSuccess(res, 200, "Tally export data fetched", data);
});

const tallyExportCSV = asyncHandler(async (req, res) => {
  const data = await getTallyExportData({
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    franchiseId: req.query.franchiseId,
    garageId: req.query.garageId,
  });
  const csv = toCSV(data.rows);
  const filename = `tally-export-${req.query.dateFrom}-to-${req.query.dateTo}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
});

module.exports = { tallyExportJSON, tallyExportCSV };
