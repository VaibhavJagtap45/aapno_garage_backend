const Garage = require("../models/Garage.model");
const resolveGarageId = require("./resolveGarageId");

async function resolveGarageContext(user) {
  const garageId = await resolveGarageId(user);
  if (!garageId) return null;

  const garage = await Garage.findById(garageId).lean();
  if (!garage) return null;

  return {
    garageId: garage._id,
    garage,
    franchiseId: garage.franchiseId || null,
  };
}

module.exports = resolveGarageContext;
