function roundCurrency(value) {
  const amount = Number(value) || 0;
  return Number(Math.max(amount, 0).toFixed(2));
}

function roundPercent(value) {
  return roundCurrency(value);
}

function clampDiscount(value, maxBase) {
  return roundCurrency(Math.min(Number(value) || 0, Math.max(Number(maxBase) || 0, 0)));
}

function toName(value, fallback) {
  const name = String(value || "").trim();
  return name || fallback;
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function pickNestedId(value) {
  if (!value) return null;
  if (typeof value === "object") {
    return value._id || value.id || null;
  }
  return value;
}

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toObjectIdOrNull(value) {
  return pickNestedId(value) || null;
}

function computeTaxAmount(baseAmount, taxPercent) {
  return roundCurrency(baseAmount * (taxPercent / 100));
}

function normalizeRepairServiceLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const price = roundCurrency(
      pickFirstDefined(
        line?.price,
        line?.mrp,
        line?.sellingPrice,
        line?.amount,
        line?.lineTotal,
      ),
    );
    const discount = clampDiscount(line?.discount, price);
    const taxPercent = roundPercent(line?.taxPercent);
    const taxableAmount = roundCurrency(price - discount);
    const taxAmount = computeTaxAmount(taxableAmount, taxPercent);

    return {
      catalogId: toObjectIdOrNull(
        pickFirstDefined(line?.catalogId, line?.serviceId, line?.service?._id),
      ),
      name: toName(
        pickFirstDefined(line?.name, line?.serviceName, line?.title),
        "Service",
      ),
      price,
      discount,
      taxPercent,
      lineTotal: roundCurrency(taxableAmount + taxAmount),
    };
  });
}

function normalizeRepairPartLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const quantity = Math.max(
      parseInt(pickFirstDefined(line?.quantity, line?.qty), 10) || 1,
      1,
    );
    const unitPrice = roundCurrency(
      pickFirstDefined(
        line?.unitPrice,
        line?.price,
        line?.mrp,
        line?.sellingPrice,
        line?.rate,
      ),
    );
    const grossAmount = roundCurrency(unitPrice * quantity);
    const discount = clampDiscount(line?.discount, grossAmount);
    const taxPercent = roundPercent(line?.taxPercent);
    const taxableAmount = roundCurrency(grossAmount - discount);
    const taxAmount = computeTaxAmount(taxableAmount, taxPercent);

    return {
      inventoryId: toObjectIdOrNull(
        pickFirstDefined(line?.inventoryId, line?.itemId, line?.part?._id),
      ),
      partCode: toNullableString(
        pickFirstDefined(line?.partCode, line?.code, line?.no),
      ),
      name: toName(
        pickFirstDefined(line?.name, line?.partName, line?.title),
        "Part",
      ),
      quantity,
      unitPrice,
      discount,
      taxPercent,
      lineTotal: roundCurrency(taxableAmount + taxAmount),
    };
  });
}

function computeRepairOrderTotals(services = [], parts = []) {
  const servicesTotal = roundCurrency(
    services.reduce((sum, line) => sum + (Number(line?.lineTotal) || 0), 0),
  );
  const partsTotal = roundCurrency(
    parts.reduce((sum, line) => sum + (Number(line?.lineTotal) || 0), 0),
  );

  const taxTotal = roundCurrency(
    [
      ...services.map((line) => {
        const taxableAmount = roundCurrency((Number(line?.price) || 0) - (Number(line?.discount) || 0));
        return computeTaxAmount(taxableAmount, roundPercent(line?.taxPercent));
      }),
      ...parts.map((line) => {
        const grossAmount = roundCurrency((Number(line?.unitPrice) || 0) * Math.max(Number(line?.quantity) || 1, 1));
        const taxableAmount = roundCurrency(grossAmount - (Number(line?.discount) || 0));
        return computeTaxAmount(taxableAmount, roundPercent(line?.taxPercent));
      }),
    ].reduce((sum, value) => sum + value, 0),
  );

  const discountAmount = roundCurrency(
    [...services, ...parts].reduce((sum, line) => sum + (Number(line?.discount) || 0), 0),
  );

  return {
    laborTotal: servicesTotal,
    partsTotal,
    taxTotal,
    totalAmount: roundCurrency(servicesTotal + partsTotal),
    discountAmount,
  };
}

function normalizeInvoiceServiceLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const price = roundCurrency(line?.price);
    const discount = clampDiscount(line?.discount, price);
    const taxPercent = roundPercent(line?.taxPercent);

    return {
      catalogId: toObjectIdOrNull(line?.catalogId),
      name: toName(line?.name, "Service"),
      price,
      discount,
      taxPercent,
      lineTotal: roundCurrency(price - discount),
    };
  });
}

function normalizeInvoicePartLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const quantity = Math.max(parseInt(line?.quantity, 10) || 1, 1);
    const unitPrice = roundCurrency(line?.unitPrice);
    const grossAmount = roundCurrency(unitPrice * quantity);
    const discount = clampDiscount(line?.discount, grossAmount);
    const taxPercent = roundPercent(line?.taxPercent);

    return {
      inventoryId: toObjectIdOrNull(line?.inventoryId),
      partCode: toNullableString(line?.partCode),
      name: toName(line?.name, "Part"),
      quantity,
      unitPrice,
      discount,
      taxPercent,
      lineTotal: roundCurrency(grossAmount - discount),
    };
  });
}

function computeInvoiceTotals(
  services = [],
  parts = [],
  labourPercent = 20,
  discountAmount = 0,
) {
  const servicesSubTotal = roundCurrency(
    services.reduce((sum, line) => sum + (Number(line?.lineTotal) || 0), 0),
  );
  const partsSubTotal = roundCurrency(
    parts.reduce((sum, line) => sum + (Number(line?.lineTotal) || 0), 0),
  );
  const safeLabourPercent = roundPercent(labourPercent);
  const labourCharge = roundCurrency(servicesSubTotal * (safeLabourPercent / 100));
  const taxAmount = roundCurrency(
    [...services, ...parts].reduce(
      (sum, line) =>
        sum + computeTaxAmount(Number(line?.lineTotal) || 0, roundPercent(line?.taxPercent)),
      0,
    ),
  );

  const maxDiscount = servicesSubTotal + partsSubTotal + labourCharge + taxAmount;
  const safeDiscountAmount = clampDiscount(discountAmount, maxDiscount);

  return {
    servicesSubTotal,
    partsSubTotal,
    labourCharge,
    labourPercent: safeLabourPercent,
    taxAmount,
    discountAmount: safeDiscountAmount,
    totalAmount: roundCurrency(
      servicesSubTotal + partsSubTotal + labourCharge + taxAmount - safeDiscountAmount,
    ),
  };
}

module.exports = {
  normalizeRepairServiceLines,
  normalizeRepairPartLines,
  computeRepairOrderTotals,
  normalizeInvoiceServiceLines,
  normalizeInvoicePartLines,
  computeInvoiceTotals,
};
