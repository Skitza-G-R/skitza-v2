export const PROOF_STAGING_LIFECYCLE_RULE_ID = "skitza-proof-staging-expire-after-1-day";
export const PROOF_STAGING_PREFIX = "proof-staging/";
export const PROOF_STAGING_EXPIRATION_DAYS = 1;

export function requiredProofStagingLifecycleRule() {
  return {
    ID: PROOF_STAGING_LIFECYCLE_RULE_ID,
    Status: "Enabled",
    Filter: {
      Prefix: PROOF_STAGING_PREFIX,
    },
    Expiration: {
      Days: PROOF_STAGING_EXPIRATION_DAYS,
    },
  };
}

export function inspectProofStagingLifecycleRules(rules) {
  const matchingRules = rules.filter((rule) => rule.ID === PROOF_STAGING_LIFECYCLE_RULE_ID);

  if (matchingRules.length !== 1) {
    return {
      ok: false,
      message:
        matchingRules.length === 0
          ? `Lifecycle rule ${PROOF_STAGING_LIFECYCLE_RULE_ID} is missing`
          : `Lifecycle rule ${PROOF_STAGING_LIFECYCLE_RULE_ID} is duplicated`,
    };
  }

  const [rule] = matchingRules;
  const filterKeys = Object.keys(rule.Filter ?? {});
  if (
    rule.Status !== "Enabled" ||
    filterKeys.length !== 1 ||
    filterKeys[0] !== "Prefix" ||
    rule.Filter?.Prefix !== PROOF_STAGING_PREFIX ||
    rule.Expiration?.Days !== PROOF_STAGING_EXPIRATION_DAYS ||
    rule.Expiration.Date !== undefined ||
    rule.Expiration.ExpiredObjectDeleteMarker !== undefined ||
    rule.AbortIncompleteMultipartUpload !== undefined ||
    rule.NoncurrentVersionExpiration !== undefined ||
    rule.NoncurrentVersionTransitions !== undefined ||
    rule.Transitions !== undefined
  ) {
    return {
      ok: false,
      message: `Lifecycle rule ${PROOF_STAGING_LIFECYCLE_RULE_ID} does not match the required proof-staging-only 1-day expiration`,
    };
  }

  return { ok: true, message: "Lifecycle rule is correct" };
}

export function upsertProofStagingLifecycleRule(rules) {
  const matchingRules = rules.filter((rule) => rule.ID === PROOF_STAGING_LIFECYCLE_RULE_ID);
  if (matchingRules.length > 1) {
    throw new Error(
      `Refusing to replace duplicated lifecycle rule ${PROOF_STAGING_LIFECYCLE_RULE_ID}`,
    );
  }

  const requiredRule = requiredProofStagingLifecycleRule();
  let replaced = false;
  const nextRules = rules.map((rule) => {
    if (rule.ID !== PROOF_STAGING_LIFECYCLE_RULE_ID) return rule;
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
