# Check "hours_match_timecards" for skill halcyon-invoice-review v1. Written by Claude (claude-opus-5-5); rules r2.
# Mirrors the deterministic calc/ check of the same name. calc/ is authoritative.

import re

LABOR_RE = re.compile(r'^Labor: (.+) \((.+)\) - week ending (\d{4}-\d{2}-\d{2})$')

def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def check(invoice, vendor, timecards):
    name_to_id = {}
    for e in (vendor or {}).get('employees', []) or []:
        n = str(e.get('name', '')).strip()
        if n and n not in name_to_id:
            name_to_id[n] = e.get('employee_id')
    approved = {}
    for tc in timecards or []:
        if tc.get('status') != 'approved':
            continue
        h = _num(tc.get('approved_hours'))
        if h is None:
            continue
        key = (tc.get('employee_id'), str(tc.get('week_ending')))
        approved[key] = approved.get(key, 0.0) + h
    failing = []
    for i, line in enumerate(invoice.get('line_items', []) or []):
        m = LABOR_RE.match(str(line.get('description', '')))
        if not m:
            continue
        name = m.group(1).strip()
        week = m.group(3)
        emp = name_to_id.get(name)
        hours = _num(line.get('quantity'))
        if emp is None or hours is None:
            failing.append(i)
            continue
        key = (emp, week)
        if key not in approved:
            failing.append(i)
            continue
        if round(hours, 2) > round(approved[key], 2):
            failing.append(i)
    return {'result': 'fail' if failing else 'pass', 'failing_lines': failing}
