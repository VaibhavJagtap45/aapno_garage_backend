// Dump every index whose key starts with garageId, across all collections,
// to find any stale single-field unique index that doesn't match the current schema.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const c of collections) {
    const indexes = await mongoose.connection.db.collection(c.name).indexes();
    const garageIdIndexes = indexes.filter((i) => i.key && Object.keys(i.key)[0] === "garageId");
    if (garageIdIndexes.length === 0) continue;
    console.log("===", c.name, "===");
    for (const ix of garageIdIndexes) {
      console.log(JSON.stringify({ name: ix.name, key: ix.key, unique: ix.unique || false, sparse: ix.sparse || false, partialFilterExpression: ix.partialFilterExpression || null }));
    }
  }
  await mongoose.disconnect();
})();
