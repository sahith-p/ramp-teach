# Check "no_duplicate_lines" for skill halcyon-invoice-review v2. Written by Claude (claude-opus-5-5); rules r1.
# Mirrors the deterministic calc/ check of the same name. calc/ is authoritative.

import re

LABOR_RE = re.compile(r'^Labor: (.+) \((.+)\) - week ending (\d{4}-\d{2}-\d{2})$')

def check(invoice, vendor, timecards):
    name_to_id = {}
    for e in (vendor or {}).get('employees', []) or []:
        n = e.get('name')
        if n is not None:
            name_to_id[n.strip()] = e.get('employee_id')
    groups = {}
    for i, line in enumerate((invoice or {}).get('line_items', []) or []):
        desc = line.get('description') or ''
        m = LABOR_RE.match(desc)
        if not m:
            continue
        name = m.group(1).strip()
        week = m.group(3)
        emp = name_to_id.get(name)
        key = ('id', emp, week) if emp is not None else ('name', name, week)
        groups.setdefault(key, []).append(i)
    failing = []
    for idxs in groups.values():
        if len(idxs) > 1:
            failing.extend(idxs)
    failing = sorted(set(failing))
    return {'result': 'fail' if failing else 'pass', 'failing_lines': failing}
