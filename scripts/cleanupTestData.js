require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;

  // Hard-delete test repair orders (RO-00002, RO-00003 just created by smoke tests).
  const roResult = await db.collection("repairorders").deleteMany({
    orderNo: { $in: ["RO-00001", "RO-00002", "RO-00003"] },
  });
  console.log("hard-deleted test repair orders:", roResult.deletedCount);

  // Delete catalog rows whose name starts with "Wheel alignment " or "Brake oil change "
  // (the dynamic names used in the smoke test) — these were auto-created by syncManualRepairOrderItems.
  const catResult = await db.collection("garageservicecatalogs").deleteMany({
    $or: [
      { name: /^Wheel alignment /i },
      { name: /^Brake oil change /i },
      { name: "Admin RO test" },
      { name: "Admin test service" },
    ],
  });
  console.log("deleted test catalog rows:", catResult.deletedCount);

  // Delete the auto-created "Test part" inventory rows from earlier smoke runs.
  const invResult = await db.collection("inventories").deleteMany({
    partName: { $in: ["Test part"] },
  });
  console.log("deleted test inventory rows:", invResult.deletedCount);

  await mongoose.disconnect();
})();
