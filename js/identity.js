// ── Identity: Shared berry identity and normalization module ──
// Used by both upload.js (parsing) and dataLoader.js (lot derivation).
// Global object — no ES modules on client side (project convention).

const Identity = {
  // Deterministic sample_seq assignment: within each (sample_id, sample_date) group,
  // sort by stable fields then assign seq 1, 2, 3...
  // Mutates rows in-place and returns them.
  canonicalSeqAssign(rows) {
    const groups = {};
    rows.forEach(r => {
      const key = `${r.sample_id}|${r.sample_date || ''}`;
      (groups[key] = groups[key] || []).push(r);
    });
    for (const group of Object.values(groups)) {
      group.sort((a, b) => {
        return (a.sample_type || '').localeCompare(b.sample_type || '')
            || (a.vessel_id || '').localeCompare(b.vessel_id || '')
            || (a.brix ?? -Infinity) - (b.brix ?? -Infinity)
            || (a.ph ?? -Infinity) - (b.ph ?? -Infinity)
            || (a.ta ?? -Infinity) - (b.ta ?? -Infinity)
            || (a.berry_weight ?? -Infinity) - (b.berry_weight ?? -Infinity)
            || (a.tant ?? -Infinity) - (b.tant ?? -Infinity)
            || JSON.stringify(a).localeCompare(JSON.stringify(b));
      });
      group.forEach((r, i) => { r.sample_seq = i + 1; });
    }
    return rows;
  },

  // Extract lot code from sample_id by stripping vintage prefix and known suffixes.
  extractLotCode(sampleId) {
    if (!sampleId) return '';
    let code = String(sampleId);
    // Remove vintage prefix (e.g. 24, 25)
    code = code.replace(/^\d{2}/, '');
    // Remove _BERRIES, _RECEPCION suffixes
    code = code.replace(/_(BERRIES|RECEPCION)$/i, '');
    return code;
  }
};
