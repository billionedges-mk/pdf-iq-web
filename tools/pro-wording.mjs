/**
 * Phrases only a Pro path produces — the tripwire both gates use.
 *
 * `verify-pro-gate` searches the build for them: absent from every flag-off bundle, and present in
 * a flag-on build only in bundles carrying a Pro sentinel. `verify-live` searches the deployed site
 * for them, because production is the build that matters and a gate that passed locally describes
 * what was built there, not what Cloudflare is serving.
 *
 * One list for both, so adding a Pro sentence cannot update one check and not the other. Add a
 * phrase when a Pro feature adds a sentence (CLAUDE.md, "The Pro flag").
 *
 * These are wording inside Pro *code*. The free /pro/ page describes Pro in sentences of its own and
 * must not reuse any of these, or it would fail the live check for describing the thing it exists
 * to describe.
 */
export const PRO_WORDING = [
  'now searchable', 'given a text layer here', 'searchable already', 'Save as a searchable PDF',
  'Or aim for a target',
  'Protect with this password', 'Lift the limits',
];
