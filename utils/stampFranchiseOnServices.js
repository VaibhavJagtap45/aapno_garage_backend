const Garage = require("../models/Garage.model");
const Franchise = require("../models/Franchise.model");
const GarageServiceCatalog = require("../models/GarageServiceCatalog.model");

async function stampFranchiseOnServices() {
  try {
    const franchiseGarages = await Garage.find({ franchiseId: { $ne: null } })
      .select("_id franchiseId")
      .lean();

    if (!franchiseGarages.length) return;

    const franchiseIds = [...new Set(franchiseGarages.map((g) => String(g.franchiseId)))];
    const franchises = await Franchise.find({ _id: { $in: franchiseIds } })
      .select("_id sharingPolicy")
      .lean();

    const shareMap = new Map();
    for (const f of franchises) {
      if (f.sharingPolicy?.shareServices) {
        shareMap.set(String(f._id), true);
      }
    }

    let stamped = 0;
    let deduped = 0;

    for (const fId of franchiseIds) {
      if (!shareMap.has(fId)) continue;

      const garageIds = franchiseGarages
        .filter((g) => String(g.franchiseId) === fId)
        .map((g) => g._id);

      const updated = await GarageServiceCatalog.updateMany(
        { garageId: { $in: garageIds }, franchiseId: null, isDeleted: false },
        { $set: { franchiseId: fId } },
      );
      stamped += updated.modifiedCount || 0;

      const services = await GarageServiceCatalog.find({
        franchiseId: fId,
        isDeleted: false,
      })
        .sort({ createdAt: 1 })
        .select("_id name")
        .lean();

      const seen = new Map();
      const dupeIds = [];
      for (const s of services) {
        const key = s.name.toLowerCase().trim();
        if (seen.has(key)) {
          dupeIds.push(s._id);
        } else {
          seen.set(key, s._id);
        }
      }

      if (dupeIds.length) {
        await GarageServiceCatalog.updateMany(
          { _id: { $in: dupeIds } },
          { $set: { isDeleted: true } },
        );
        deduped += dupeIds.length;
      }
    }

    if (stamped || deduped) {
      console.log(`[stampFranchiseOnServices] Stamped ${stamped} services, deduped ${deduped}`);
    }
  } catch (err) {
    console.error("[stampFranchiseOnServices] Error:", err.message);
  }
}

module.exports = { stampFranchiseOnServices };
