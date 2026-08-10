export const TARGET_SCHEMA_PROPS = {
  owner: { type: "string", pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$" },
  repo: { type: "string", pattern: "^(?!\\.\\.?$)[A-Za-z0-9._-]{1,100}$" },
  issue: { type: "integer", minimum: 1 },
};

export function validateGithubTarget(input, { optional = false } = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const hasAny = raw.owner != null || raw.repo != null || raw.issue != null;
  if (optional && !hasAny) return null;
  const owner = typeof raw.owner === "string" ? raw.owner : "";
  const repo = typeof raw.repo === "string" ? raw.repo : "";
  const issue = raw.issue;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new Error("owner must be 1-39 ASCII letters/digits with optional internal hyphens");
  }
  if (!/^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new Error("repo must be 1-100 ASCII letters/digits/dot/underscore/hyphen and not . or ..");
  }
  if (!Number.isInteger(issue) || issue < 1) {
    throw new Error("issue must be a positive integer");
  }
  return { owner, repo, issue };
}
