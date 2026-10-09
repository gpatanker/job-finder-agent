/**
 * What counts as "this candidate's function" — as data, not as code.
 *
 * The title classifier in known-company-boards.ts was originally written
 * directly against one candidate's role family (Business / Strategy
 * Operations): the required head noun, the domain tiers, the exclusions and
 * the seniority band were all module-level constants. That made the precision
 * gate excellent for that candidate and structurally wrong for anyone else —
 * `classifyRoleFamily("Product Manager")` returned null, so a product
 * candidate's own target roles were rejected by the free job-board channel
 * before scoring ever ran.
 *
 * HANDOFF.md's forking section promised "nothing about the code needs to
 * change; everything about the data and defaults does." This file is what
 * makes that promise true. The *shape* of the gate is kept — it is the part
 * that took a dozen real false-positive corpora to get right — and only the
 * vocabulary moves into the candidate's own profile.
 *
 * The gate's shape, unchanged:
 *   1. An unjudgeable title (non-Latin script, punctuation only) is rejected
 *      rather than guessed at.
 *   2. A disqualifying domain rejects outright, however good the rest looks.
 *   3. An excluded family rejects unless a rescue phrase also matches.
 *   4. A conditional domain is only allowed alongside a qualifying word.
 *   5. Otherwise the title needs the head noun, and its tier comes from which
 *      domain qualifier it carries.
 */

/** Strongest match first; null means "not this candidate's function at all". */
export type RoleFamilyTier = "core" | "strategy-ops" | "strategy" | "adjacent" | null;

export type RoleScope = {
  /** Human label, for logs and the seed template. */
  label: string;

  /**
   * The function itself. A title containing none of these is not this role at
   * all, however many domain words it carries. For ops this is
   * operations/ops; for product it is product.
   */
  headTerms: string[];

  /**
   * A second head noun that qualifies in COMBINATION with the primary one and,
   * with a core domain, on its own. For the ops scope this is
   * strategy/strategic, which is why "Strategy & Operations" classifies even
   * though "strategy" alone does not.
   */
  secondaryHeadTerms: string[];

  /**
   * Whether the head noun ALONE is enough to count as core.
   *
   * This is the one genuinely semantic difference between role families, not a
   * vocabulary difference. For operations it must be false: bare "Operations
   * Manager" with no qualifying domain was the single biggest source of
   * garbage in the 2026-07-27 corpus, because every profession has operations
   * managers. For product it must be true: "Product Manager" is not a vague
   * title needing a qualifier, it is exactly the target.
   */
  bareHeadIsCore: boolean;

  /** Domains that ARE the candidate's function -> "core". */
  coreDomains: string[];

  /** Worth surfacing but a weaker fit -> "adjacent", scored lower. */
  adjacentDomains: string[];

  /**
   * A different profession that happens to share the head noun. Rejected even
   * when a core domain is also present, because "People Strategy & Operations"
   * names a core domain and is still the wrong job.
   */
  disqualifyingDomains: string[];

  /**
   * Allowed only when a head or secondary-head word is also present, so
   * "Supply Chain Manager" is rejected while "Strategy & Operations Manager,
   * Supply" is not.
   */
  conditionalDomains: string[];

  /**
   * A family to exclude that the domain lists would otherwise admit, together
   * with the phrases that rescue a title from it. The ops scope uses this for
   * go-to-market: a GTM word disqualifies, UNLESS the title is also explicitly
   * Business Operations. Leave both empty for scopes that need no such carve-out.
   */
  excludedDomains: string[];
  rescuePhrases: string[];

  /** Above the candidate's reach — matched as whole words, case-insensitive. */
  overSeniorTerms: string[];

  /** Below it: trade-level or pre-professional titles. */
  underLeveledTerms: string[];

  /**
   * Candidate-specific scoring rules, injected verbatim into the Job Search
   * Agent's rubric prompt. The rubric's generic scaffolding (spread the
   * scores, don't score on industry, reserve 85+) stays in code; what counts
   * as in or out of scope for this person lives here.
   */
  rubricRules: string;
};

/**
 * The original candidate's scope: Business / Strategy / Infrastructure
 * Operations. Every value here was lifted verbatim from the module-level
 * constants it replaced, so this is the behaviour-preserving default — an
 * instance that sets no `roleScope` classifies exactly as it did before.
 */
export const OPS_ROLE_SCOPE: RoleScope = {
  label: "Business / Strategy Operations",
  headTerms: ["operations", "operation", "ops", "revops", "bizops", "biz ops", "rev ops"],
  secondaryHeadTerms: ["strategy", "strategic"],
  bareHeadIsCore: false,
  coreDomains: [
    "business",
    "biz",
    "bizops",
    "revenue",
    "revops",
    "rev",
    "gtm",
    "go to market",
    "commercial",
    "corporate",
  ],
  adjacentDomains: [
    "sales",
    "growth",
    "partner",
    "partners",
    "partnership",
    "partnerships",
    "channel",
    "technical",
    "product",
    "pricing",
    "customer success",
    "deal desk",
    "compute",
    "infrastructure",
    "infra",
    "data center",
    "datacenter",
  ],
  disqualifyingDomains: [
    // HR / recruiting
    "recruiting", "recruitment", "recruiter", "talent", "hr", "human resources",
    "people", "personnel", "payroll", "benefits", "compensation", "immigration",
    "onboarding specialist",
    // Facilities / workplace / admin
    "workplace", "facilities", "facility", "real estate", "office manager", "executive assistant",
    // Healthcare / clinical
    "clinical", "patient", "medical", "nursing", "nurse", "pharmacy", "veterinary",
    // Money-movement back office
    "billing", "treasury", "collections", "accounts payable", "accounts receivable",
    "payroll operations", "loan", "lending", "claims", "underwriting", "escrow",
    // IT / infosec / network operations centers
    "it operations", "it ops", "information technology", "helpdesk", "help desk",
    "service desk", "desktop", "network operations", "security operations", "soc",
    // Content / community / trust & safety
    "content", "moderation", "trust and safety", "editorial", "social media",
    "community", "creative", "studio", "brand",
    // Physical/industrial and consumer-venue operations
    "restaurant", "kitchen", "culinary", "hospitality", "hotel", "retail store",
    "housekeeping", "janitorial", "farm", "agriculture", "mining", "construction",
    // Other functions that borrow "operations"
    "data operations", "labeling", "annotation", "lifecycle", "hardware",
    "research operations", "legal operations", "flight", "aviation", "maritime",
    // Finance and marketing — hard exclusions, not softer ADJACENT_DOMAINS
    // qualifiers, even when paired with "business"/"operations"/"strategy"
    // (confirmed 2026-07-28: "Strategic Finance - Business Operations Lead"
    // and "Manager, Strategic Finance & Business Operations" are explicitly
    // out of scope despite both naming a core domain).
    "finance", "financial", "accounting", "fp a",
    "marketing",
    // Corporate Development / M&A — a distinct deal-sourcing/integration
    // specialization the candidate has no experience in, not a synonym for
    // BizOps despite sharing the word "corporate" (a CORE_DOMAINS word) and
    // often pairing with "operation(s)". Confirmed 2026-07-28 real case:
    // "Corporate Development Operation & M&A Integration Lead" (Snowflake)
    // scored 82 and got surfaced for promotion — "corporate" + "operation"
    // was enough to pass the structural test despite this being nothing like
    // the candidate's actual function.
    "corporate development", "m a", "mergers and acquisitions", "merger integration",
    // Quota-carrying / customer-facing sales IC roles — a different profession
    // from Sales *Operations*, which stays in scope via ADJACENT_DOMAINS.
    // These kept slipping through because "Strategic Account Executive" pairs
    // "strategic" with "commercial"/"sales", and because an AE title need not
    // contain the word "finance" to be a finance-vertical sales role. Confirmed
    // 2026-07-28 real cases: "Strategic Account Executive, Retail & Commercial
    // Banking - FSI" (Anthropic), "Manager, Account Executive - Strategic
    // Sales" (Anthropic), "Strategic Account Executive, New Vertical Sales"
    // (Flex), "Sales Manager, Strategic Accounts" (Ripple).
    "account executive", "account executives", "account manager", "account managers",
    // Sales/business development rep pipeline-generation roles. Short forms are
    // safe here because hasAny is space-bounded, so a bare "sdr"/"bdr" token
    // can't match inside a longer word. Confirmed 2026-07-28: "Strategic Sales
    // Development Representative, Robotics & Automotive" (Scale AI).
    "sales development representative", "business development representative",
    "sales development rep", "business development rep", "sdr", "bdr",
    // Hands-on engineering / technical IC roles. The candidate is explicit that
    // "pure engineering does not align with what I do" — and these are not
    // caught by the structural test, because a data-center or systems
    // engineering title routinely also names "Operations" plus an
    // ADJACENT_DOMAINS word (infrastructure, data center, technical).
    // Confirmed 2026-07-28: "Sales Systems Engineer, Enterprise Operations"
    // (Perplexity), "Global Operations Engineer (Product & Change Management)"
    // (SpaceX), "Infrastructure Engineer (Data Center Operations)" (Cerebras),
    // "Quality Engineer - Rack Infrastructure & Site Operations" (OpenAI),
    // "AI Field Engineer - Strategic Partnerships" (Fireworks AI), "Data Center
    // Operations Systems Engineer" (Lambda). Deliberately just "engineer(s)",
    // not the broader "engineering" — all confirmed real cases are "...
    // Engineer" IC titles, and the broader form would also exclude a
    // legitimate BizOps-for-the-engineering-org title like "Engineering
    // Strategy & Operations Manager", which isn't evidenced as unwanted.
    // "Infrastructure Operations" and "AI Infrastructure Operations" are the
    // candidate's own role families and stay in scope, as does "Technical
    // Program Manager", which contains neither word.
    "engineer", "engineers",
    // "Network Operations" is already excluded above under IT/NOC, but the
    // singular operator form is a different string and slipped through:
    // "Network Operator, Data Center Operations" (Fluidstack, 2026-07-28).
    "network operator", "network operators",
    // Level, not domain, but never worth surfacing
    "intern", "internship", "apprentice",
  ],
  conditionalDomains: [
    "warehouse", "logistics", "supply chain", "supply", "fulfillment", "fulfilment",
    "inventory", "procurement", "distribution", "transportation", "fleet", "dispatch",
    "courier", "driver", "trucking", "manufacturing", "plant", "maintenance",
    "support", "service operations", "call center", "contact center", "field operations",
  ],
  excludedDomains: [
    "gtm",
    "go to market",
    // "sales" is deliberately absent (candidate correction, 2026-09-13): Sales
    // Operations and Sales Strategy & Operations are in scope. Only
    // GTM-branded and revenue/growth-motion titles are excluded.
    "revenue",
    "revops",
    "rev ops",
    "growth",
    "customer experience",
    "quota",
    "pipeline",
    "top of funnel",
    "demand generation",
  ],
  rescuePhrases: ["business operations", "business revenue", "bizops", "biz ops"],
  overSeniorTerms: ["director", "head of", "vice president", "vp", "svp", "evp", "principal"],
  underLeveledTerms: [
    "technician", "technologist", "operator", "apprentice", "intern", "installer",
    "electrician", "mechanic", "custodian", "janitor", "warehouse associate",
  ],
  rubricRules: "- Higher for: title closely matching the BizOps/Strategy & Ops/GTM Ops/RevOps/Technical Ops family; the role's actual duties involving operations/process ownership, cross-functional coordination, data-driven reporting, or GTM/revenue ops work; location in the candidate's stated metros or explicitly remote-US; salary (if listed) at or above the candidate's stated floor.\n- Lower for: pure customer-support IC roles, pure quota-carrying sales roles, or roles requiring deep hands-on software engineering the candidate's background doesn't support.\n- ADJACENT-BUT-DIFFERENT OPERATIONS SPECIALIZATIONS are NOT this candidate's function and must score low (below 40) no matter how senior or well-matched the rest of the posting looks. The word \"Operations\" in a title is not evidence of fit on its own \u2014 the qualifier in front of it is what matters. Specifically excluded: Recruiting/Talent Ops, HR/People Ops, Payroll/Benefits/Compensation Ops, Warehouse/Logistics/Supply Chain/Fulfillment/Inventory Ops, Procurement/Strategic Sourcing/Commodity Management, IT Ops/Helpdesk/NOC/Security Ops, Customer Support/Contact Center Ops, Clinical/Healthcare Ops, Billing/Treasury/Collections/Claims Ops, Content/Community/Trust & Safety Ops, Facilities/Workplace Ops, and Manufacturing/Field/Fleet Ops. Real cases the candidate dismissed after this rubric scored them 74-82: \"OpenAI \u2014 Strategic Sourcing Manager, Compute\", \"Google \u2014 GPU Commodity Manager, Global Strategic Sourcing and Silicon Operations\", \"Lambda \u2014 Procurement & Operations Lead\". A supply-chain or support-flavored title is only in scope when it is explicitly framed as a business/strategy role (e.g. \"Strategy & Operations Manager, Supply\").\n- FINANCE and MARKETING are hard exclusions \u2014 score below 40 \u2014 even when the title also names Business Operations, Strategy, or GTM in the same breath. Confirmed 2026-07-28: the candidate does not want any Finance-titled or Marketing-titled role, full stop, regardless of what else is in the title. This is a stronger rule than the general \"adjacent domain only excluded on its own\" pattern above \u2014 do not let \"Business Operations\" or \"Strategy\" in the same title override it. Real examples that must score below 40 under this rule: \"Strategic Finance - Business Operations Lead\", \"Manager, Strategic Finance & Business Operations\", \"Sr. Manager, Growth Marketing Operations\", \"FP&A Manager, Business Operations\".\n- CORPORATE DEVELOPMENT / M&A is a hard exclusion \u2014 score below 40 \u2014 even when the title also names Operations, Business, or Strategy. It is a distinct deal-sourcing and integration specialization the candidate has zero experience in, not a flavor of BizOps, and \"Corporate\" is not a qualifying domain word here. Confirmed 2026-07-28 real example: \"Corporate Development Operation & M&A Integration Lead\" (Snowflake). \"Product Strategy and Corporate Development Lead\" is excluded on the same basis.\n- QUOTA-CARRYING AND CUSTOMER-FACING SALES IC ROLES are a hard exclusion \u2014 score below 40 \u2014 even when paired with \"Strategic\", \"Commercial\", \"Enterprise\", or a named vertical. This covers Account Executive, Account Manager, Sales Manager / Manager of AEs, Sales Development Representative (SDR) and Business Development Representative (BDR), Strategic/Enterprise Customer Success Manager, and Strategic Partner/Partnerships Manager roles that are really relationship-ownership jobs. Note \"Sales Operations\", \"Partner Operations\" and \"Sales Strategy & Operations\" all remain fully in scope \u2014 the exclusion here is the selling/account-owning role, not the ops function behind it. (\"Revenue Operations\" is excluded, but separately \u2014 see the GTM/revenue-motion rule below.) Confirmed 2026-07-28 real examples that must score below 40: \"Strategic Account Executive, Retail & Commercial Banking - FSI\" (Anthropic), \"Manager, Account Executive - Strategic Sales\" (Anthropic), \"Strategic Account Executive, New Vertical Sales\" (Flex), \"Sales Manager, Strategic Accounts\" (Ripple), \"Strategic Sales Development Representative, Robotics & Automotive\" (Scale AI).\n- HANDS-ON ENGINEERING AND TECHNICAL IC ROLES are a hard exclusion \u2014 score below 40 \u2014 for any title containing \"Engineer\" (as in \"...Engineer\" job titles \u2014 not the broader \"Engineering\" as a modifier, which can legitimately describe a BizOps-for-the-engineering-org role), even when it also names Operations, Infrastructure, Data Center, or Strategic Partnerships. The candidate is explicit that pure engineering does not align with his background. This is stronger than the general software-engineering line above, because these titles are not obviously software roles and kept scoring in the 60s-70s on the strength of their \"Operations\" qualifier. Confirmed 2026-07-28 real examples: \"Sales Systems Engineer, Enterprise Operations\" (Perplexity), \"Global Operations Engineer (Product & Change Management)\" (SpaceX), \"Infrastructure Engineer (Data Center Operations)\" (Cerebras), \"Quality Engineer - Rack Infrastructure & Site Operations - Stargate\" (OpenAI), \"AI Field Engineer - Strategic Partnerships\" (Fireworks AI), \"Data Center Operations Systems Engineer\" (Lambda). Also excluded on the same hands-on-technical-IC basis, and equally hard: any title naming a manual or technical TRADE or a pre-professional level \u2014 Technician, Technologist, Operator, Apprentice, Intern, Installer, Electrician, Mechanic. Confirmed 2026-08-26 real example: \"Associate Data Center Operations Technician\" (xAI, Memphis TN), which the candidate called out directly \u2014 \"data center Ops technician are not roles that align with what I do\". The domain word (\"Data Center\", \"Operations\") is not the problem; the trade-level nature of the work is. What stays IN scope: non-engineer-titled roles in the same domains \u2014 \"Infrastructure Operations\", \"AI Infrastructure Operations\", \"Technical Program Manager\", and a title like \"Engineering Strategy & Operations Manager\" are the candidate's own role families and target titles, not excluded by this rule.\n- GO-TO-MARKET AND REVENUE-MOTION OPERATIONS is a hard exclusion \u2014 score below 40. This covers GTM Strategy & Operations, Revenue Operations / RevOps, Revenue Strategy & Operations, Growth Strategy & Operations, Customer Experience Strategy & Operations, and any ops role centred on quota, pipeline, top-of-funnel or demand generation. NOTE: \"Sales Operations\" and \"Sales Strategy & Operations\" are NOT excluded and remain in scope \u2014 the candidate confirmed this on 2026-09-13; his AWS role was Business Operations Analyst on the Public Sector Partners team, so sales-adjacent operations is his actual background. Plain \"Strategy & Operations\" is likewise in scope and is a core target. The candidate stated on 2026-09-13 that he does not have go-to-market experience and does not want these roles, and the record agrees: 42 of 240 applications were GTM-flavored and produced only 2 of 9 first-round interviews. Confirmed real examples that must now score below 40: \"Senior GTM Strategy & Operations Manager, Top of Funnel\" (Vanta), \"GTM Strategy & Operations Manager, Post-Sales\" (Zip), \"GTM Strategy and Operations, Industry Lead\" (Sierra AI), \"Senior Revenue Operations Manager\" (Skydio), \"Revenue Strategy & Operations, Sr. Analyst\" (Baseten), \"Manager, Growth Strategy & Operations\" (Airwallex), \"Customer Experience Strategy & Operations Lead\" (Notion).\n  IMPORTANT EXCEPTIONS, do not over-apply this rule: (a) a title that is explicitly BUSINESS Operations stays in scope even when it also names revenue or GTM \u2014 \"Associate, Business & Revenue Operations, Air Defense\" (Anduril) is in scope and produced an interview; (b) \"Commercial Operations\" stays in scope \u2014 \"Commercial Operations Manager\" (Redwood Materials) also produced an interview, and \"commercial\" is not a go-to-market word here; (c) PRODUCT Operations stays in scope (\"Product Operations Manager\", PermitFlow \u2014 produced an interview), while Customer Experience Operations does not; (d) Business Operations, Strategy & Operations, Infrastructure/Data-Center Operations and Capacity Operations are all unaffected and remain the core targets.\n\nSENIORITY CEILING \u2014 the candidate's reach tops out at Senior Manager. Do NOT include Director, Senior Director, Associate Director, Head of, VP/Vice President, SVP, EVP, Chief-of-staff-as-a-title, or any more senior title, even if everything else about the role is a strong match. PRINCIPAL-titled roles are also out of reach \u2014 confirmed 2026-07-28 after the candidate rejected \"Principal, Strategic Partnerships (Health Systems)\" (Assort Health) and \"Principal Electrical Operations Lead \u2014 Data Center Operations\" (Fluidstack) as too senior for him. Exclude \"Principal\" anywhere in the title, whether it's the whole level (\"Principal, Business Operations\") or a modifier on the function (\"Principal Operations Lead\"). Manager, Senior Manager, Lead, and Staff-level titles are still fair game \u2014 the line is now Principal-and-above, not Director-and-above.",
};

/**
 * A worked second example, so a fork has something concrete to copy rather
 * than deriving a scope from scratch. Not used unless a profile selects it.
 *
 * Note what differs from the ops scope beyond vocabulary: `bareHeadIsCore` is
 * true, because "Product Manager" needs no qualifier; "principal" is absent
 * from `overSeniorTerms`, because Principal PM is a senior IC title in product
 * rather than an executive one; and `excludedDomains` is empty, since there is
 * no equivalent of the GTM carve-out here.
 */
export const PRODUCT_ROLE_SCOPE: RoleScope = {
  label: "Product Management",
  headTerms: ["product"],
  secondaryHeadTerms: ["platform", "technical"],
  bareHeadIsCore: true,
  coreDomains: ["product", "platform", "technical", "growth", "ai", "ml", "machine learning", "data", "api", "developer", "infrastructure"],
  adjacentDomains: ["program", "project", "operations", "ops", "strategy", "analytics", "design", "research"],
  disqualifyingDomains: [
    "marketing", "sales", "recruiting", "talent", "hr", "human resources", "people",
    "payroll", "benefits", "facilities", "clinical", "patient", "billing", "legal",
    "security operations", "helpdesk", "content moderation", "warehouse", "janitorial",
  ],
  conditionalDomains: ["support", "supply chain", "logistics", "manufacturing"],
  excludedDomains: [],
  rescuePhrases: [],
  overSeniorTerms: ["director", "head of", "vice president", "vp", "svp", "evp", "chief"],
  underLeveledTerms: ["intern", "apprentice", "technician", "operator", "installer"],
  rubricRules: "",
};

/** Built-in scopes a profile can select by name instead of spelling one out. */
export const BUILT_IN_ROLE_SCOPES: Record<string, RoleScope> = {
  ops: OPS_ROLE_SCOPE,
  product: PRODUCT_ROLE_SCOPE,
};

/**
 * Resolves whatever a profile carries into a usable scope.
 *
 * Accepts a built-in name, a full inline scope, or a partial one that
 * overrides a named preset — so a fork can start from `product` and add three
 * disqualifying domains without restating the whole object. Falls back to the
 * ops scope when nothing is set, which is what keeps the original instance
 * byte-identical after this refactor.
 */
export function resolveRoleScope(
  configured?: string | (Partial<RoleScope> & { extends?: string }) | null
): RoleScope {
  if (!configured) return OPS_ROLE_SCOPE;
  if (typeof configured === "string") return BUILT_IN_ROLE_SCOPES[configured] ?? OPS_ROLE_SCOPE;
  const base = configured.extends ? BUILT_IN_ROLE_SCOPES[configured.extends] ?? OPS_ROLE_SCOPE : OPS_ROLE_SCOPE;
  const { extends: _ignored, ...rest } = configured;
  // JSON has no comments, so the seed template documents itself with `_`-prefixed
  // keys. Strip them rather than letting them ride along as stray properties on
  // the resolved scope. Also drop explicit nulls/undefined, so a half-filled
  // template field falls back to the preset instead of blanking a word list.
  const overrides = Object.fromEntries(
    Object.entries(rest).filter(([k, v]) => !k.startsWith("_") && v !== null && v !== undefined)
  );
  return { ...base, ...overrides };
}
