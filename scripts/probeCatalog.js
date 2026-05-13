require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  const docs = await db.collection("garageservicecatalogs").find({}).toArray();
  console.log("total docs:", docs.length);
  docs.forEach((d) =>
    console.log({
      _id: d._id,
      garageId: String(d.garageId),
      name: d.name,
      serviceNo: d.serviceNo,
      hasServiceNoField: Object.prototype.hasOwnProperty.call(d, "serviceNo"),
      isDeleted: d.isDeleted,
      createdAt: d.createdAt,
    }),
  );
  await mongoose.disconnect();
})();
