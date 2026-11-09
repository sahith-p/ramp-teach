/**
 * Smoke-test fixture for the recorder lane (T-14). NOT the real fixture portal (that is app/portal/**,
 * built by the fixture lane). It mirrors the lane-spec §2 portal routes closely enough that the same
 * scripted driver (record-session.ts) runs against both:
 *
 *   GET  /portal/login                         username/password form, button "Sign in"
 *   POST /api/portal/login                     ap.reviewer / demo-only → cookie + 303 /portal/invoices
 *   GET  /portal/invoices                      table with a link to /portal/invoices/TEST
 *   GET  /portal/invoices/TEST                 line items, each labor line has "View timecard"
 *   GET  /portal/employees/<id>?week=<date>    [data-field] markers incl. approved_hours
 *
 * Synthetic data only. Standalone: `npx tsx extension/scripts/fixture-test-server.ts [port]` (default 3013).
 */
import http from "node:http";
import { fileURLToPath } from "node:url";

export const SMOKE_PORT = 3013;
export const SMOKE_INVOICE = "TEST";

const EMPLOYEES: Record<string, { name: string; role: string; week: string; hours: number }> = {
  "E-901": { name: "Test Person One", role: "Sourcer", week: "2026-10-11", hours: 38 },
  "E-902": { name: "Test Person Two", role: "Data Analyst", week: "2026-10-11", hours: 40 },
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#1f1f1f}table{border-collapse:collapse}
td,th{border-bottom:1px solid #e6e6e3;padding:6px 10px;text-align:left}.num{text-align:right}
.label{background:#f7f7f5;border:1px solid #e6e6e3;padding:4px 8px;display:inline-block;font-size:12px}</style></head>
<body><p class="label">Smoke-test fixture (recorder lane) — synthetic data · Unofficial demo</p>
<main>${body}</main></body></html>`;
}

function authed(req: http.IncomingMessage): boolean {
  return /(?:^|;\s*)portal_session=ok(?:;|$)/.test(req.headers.cookie ?? "");
}

function send(res: http.ServerResponse, status: number, html: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}

function redirect(res: http.ServerResponse, to: string, headers: Record<string, string> = {}) {
  res.writeHead(303, { location: to, ...headers });
  res.end();
}

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  if (req.method === "POST" && p === "/api/portal/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      if (form.get("username") === "ap.reviewer" && form.get("password") === "demo-only") {
        redirect(res, "/portal/invoices", { "set-cookie": "portal_session=ok; Path=/; HttpOnly; SameSite=Lax" });
      } else {
        redirect(res, "/portal/login?error=1");
      }
    });
    return;
  }

  if (p === "/" || p === "/portal") return redirect(res, "/portal/login");

  if (p === "/portal/login") {
    const err = url.searchParams.get("error") ? `<p role="alert" style="color:#b42318">Invalid credentials.</p>` : "";
    return send(
      res,
      200,
      page(
        "Vendor portal — Sign in",
        `<h1>Vendor timecard portal</h1>${err}
<form method="post" action="/api/portal/login">
  <p><label>Username <input name="username" type="text" autocomplete="username"></label></p>
  <p><label>Password <input name="password" type="password" autocomplete="current-password"></label></p>
  <button type="submit">Sign in</button>
</form>
<p>Demo credentials: username <code>ap.reviewer</code>, password <code>demo-only</code></p>`,
      ),
    );
  }

  if (p.startsWith("/portal/") && !authed(req)) return redirect(res, "/portal/login");

  if (p === "/portal/invoices") {
    return send(
      res,
      200,
      page(
        "Invoices — Vendor portal",
        `<h1>Invoices</h1><table><thead><tr><th>Invoice</th><th>Week ending</th><th class="num">Total</th></tr></thead>
<tbody><tr><td><a href="/portal/invoices/${SMOKE_INVOICE}">${SMOKE_INVOICE}</a></td><td>2026-10-11</td><td class="num">$7,180.00</td></tr></tbody></table>`,
      ),
    );
  }

  if (p === `/portal/invoices/${SMOKE_INVOICE}`) {
    const rows = Object.entries(EMPLOYEES)
      .map(
        ([id, e]) =>
          `<tr><td>Labor: ${esc(e.name)} (${esc(e.role)}) - week ending ${e.week}</td><td class="num">${e.hours}</td>
<td><a href="/portal/employees/${id}?week=${e.week}">View timecard</a></td></tr>`,
      )
      .join("");
    return send(
      res,
      200,
      page(
        `Invoice ${SMOKE_INVOICE} — Vendor portal`,
        `<h1>Invoice <span data-field="invoice_id">${SMOKE_INVOICE}</span></h1>
<table id="line-items"><thead><tr><th>Description</th><th class="num">Hours</th><th></th></tr></thead><tbody>${rows}
<tr><td>Background check fee</td><td class="num">1</td><td></td></tr></tbody></table>
<p><a href="/portal/invoices">Back to invoices</a></p>`,
      ),
    );
  }

  const emp = p.match(/^\/portal\/employees\/([^/]+)$/);
  if (emp) {
    const e = EMPLOYEES[emp[1]];
    const week = url.searchParams.get("week");
    if (!e || week !== e.week) return send(res, 200, page("No timecard found", "<h1>No timecard found</h1>"));
    return send(
      res,
      200,
      page(
        `Timecard ${e.name} ${week} — Vendor portal`,
        `<h1>Timecard</h1><dl>
<dt>Employee ID</dt><dd data-field="employee_id">${emp[1]}</dd>
<dt>Name</dt><dd data-field="employee_name">${esc(e.name)}</dd>
<dt>Role</dt><dd data-field="role">${esc(e.role)}</dd>
<dt>Week ending</dt><dd data-field="week_ending">${week}</dd>
<dt>Approved hours</dt><dd data-field="approved_hours">${e.hours}</dd>
<dt>Status</dt><dd data-field="status">approved</dd>
<dt>Approved by</dt><dd data-field="approved_by">Test Manager</dd></dl>`,
      ),
    );
  }

  send(res, 404, page("Not found", "<h1>Not found</h1>"));
}

/** Start the smoke fixture; resolves once listening. */
export function startFixtureServer(port = SMOKE_PORT): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? SMOKE_PORT);
  startFixtureServer(port).then(() => console.log(`smoke fixture on http://localhost:${port}/portal/login`));
}
