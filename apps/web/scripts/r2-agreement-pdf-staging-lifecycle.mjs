export const AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID =
  "skitza-agreement-pdf-staging-expire-after-1-day";
export const AGREEMENT_PDF_STAGING_PREFIX = "agreement-pdf-staging/";
export const AGREEMENT_PDF_STAGING_EXPIRATION_DAYS = 1;
export const AGREEMENT_PDF_FINAL_PREFIX = "agreement-pdfs/";

function expirationPrefix(rule) {
  const hasLegacyPrefix = Object.prototype.hasOwnProperty.call(rule, "Prefix");
  const hasFilter = Object.prototype.hasOwnProperty.call(rule, "Filter");
  if (hasLegacyPrefix || hasFilter) {
    if (hasLegacyPrefix && !hasFilter && typeof rule.Prefix === "string") return rule.Prefix;
    if (hasLegacyPrefix) return null;
  }
  const filter = rule.Filter;
  if (!filter || typeof filter !== "object") return null;
  const filterKeys = Object.keys(filter);
  if (filterKeys.length === 1 && filterKeys[0] === "Prefix") {
    return typeof filter.Prefix === "string" ? filter.Prefix : null;
  }
  if (filterKeys.length === 1 && filterKeys[0] === "And") {
    const andFilter = filter.And;
    if (!andFilter || typeof andFilter !== "object" || typeof andFilter.Prefix !== "string") {
      return null;
    }
    const supportedAndKeys = new Set([
      "Prefix",
      "Tags",
      "ObjectSizeGreaterThan",
      "ObjectSizeLessThan",
    ]);
    if (Object.keys(andFilter).some((key) => !supportedAndKeys.has(key))) return null;
    return andFilter.Prefix;
  }
  return null;
}

export function agreementPdfFinalExpirationOverlapRules(rules) {
  return rules.filter((rule) => {
    if (
      rule.ID === AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID ||
      rule.Status !== "Enabled" ||
      !rule.Expiration
    ) {
      return false;
    }
    const prefix = expirationPrefix(rule);
    if (prefix === null) return true;
    return (
      AGREEMENT_PDF_FINAL_PREFIX.startsWith(prefix) || prefix.startsWith(AGREEMENT_PDF_FINAL_PREFIX)
    );
  });
}

export function requiredAgreementPdfStagingLifecycleRule() {
  return {
    ID: AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID,
    Status: "Enabled",
    Filter: {
      Prefix: AGREEMENT_PDF_STAGING_PREFIX,
    },
    Expiration: {
      Days: AGREEMENT_PDF_STAGING_EXPIRATION_DAYS,
    },
  };
}

export function inspectAgreementPdfStagingLifecycleRules(rules) {
  const matchingRules = rules.filter((rule) => rule.ID === AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID);

  if (matchingRules.length !== 1) {
    return {
      ok: false,
      message:
        matchingRules.length === 0
          ? `Lifecycle rule ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID} is missing`
          : `Lifecycle rule ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID} is duplicated`,
    };
  }

  const [rule] = matchingRules;
  const filterKeys = Object.keys(rule.Filter ?? {});
  if (
    rule.Status !== "Enabled" ||
    filterKeys.length !== 1 ||
    filterKeys[0] !== "Prefix" ||
    rule.Filter?.Prefix !== AGREEMENT_PDF_STAGING_PREFIX ||
    rule.Expiration?.Days !== AGREEMENT_PDF_STAGING_EXPIRATION_DAYS ||
    rule.Expiration.Date !== undefined ||
    rule.Expiration.ExpiredObjectDeleteMarker !== undefined ||
    rule.AbortIncompleteMultipartUpload !== undefined ||
    rule.NoncurrentVersionExpiration !== undefined ||
    rule.NoncurrentVersionTransitions !== undefined ||
    rule.Transitions !== undefined
  ) {
    return {
      ok: false,
      message: `Lifecycle rule ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID} does not match the required agreement-pdf-staging-only 1-day expiration`,
    };
  }

  const overlappingRules = agreementPdfFinalExpirationOverlapRules(rules);
  if (overlappingRules.length > 0) {
    return {
      ok: false,
      message: "An enabled lifecycle expiration rule can match immutable agreement-pdfs objects",
    };
  }

  return { ok: true, message: "Lifecycle rule is correct" };
}

export function upsertAgreementPdfStagingLifecycleRule(rules) {
  const matchingRules = rules.filter((rule) => rule.ID === AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID);
  if (matchingRules.length > 1) {
    throw new Error(
      `Refusing to replace duplicated lifecycle rule ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID}`,
    );
  }

  const requiredRule = requiredAgreementPdfStagingLifecycleRule();
  let replaced = false;
  const nextRules = rules.map((rule) => {
    if (rule.ID !== AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID) return rule;
    replaced = true;
    return requiredRule;
  });

  if (!replaced) nextRules.push(requiredRule);
  return nextRules;
}

export function isMissingLifecycleConfiguration(error) {
  if (!error || typeof error !== "object") return false;
  return (
    error.name === "NoSuchLifecycleConfiguration" ||
    error.Code === "NoSuchLifecycleConfiguration" ||
    error.code === "NoSuchLifecycleConfiguration"
  );
}
