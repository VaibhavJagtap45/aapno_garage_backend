// Removes catalog entries where serviceNo is null. These were created by the
// admin-on-behalf flow before the serviceNo auto-generator was added; the
// compound sparse unique index (garageId, serviceNo) treats null as a value,
// so any single null-serviceNo row blocks all subsequent admin-created lines.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const result = await mongoose.connection.db
    .collection("garageservicecatalogs")
    .deleteMany({ serviceNo: null });
  console.log("deleted", result.deletedCount, "catalog rows with null serviceNo");
  await mongoose.disconnect();
})();
