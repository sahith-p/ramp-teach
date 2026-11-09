/**
 * TEST STUB of the fixture vendor portal — for agent-lane development and tests ONLY.
 *
 * The real fixture portal is app/portal/** (fixture lane, T-12) on the Next app. This tiny node:http
 * server reproduces ONLY the routes, form fields, cookie and data-field markers pinned in
 * docs/lane-spec.md §2, so the scripted evidence path and a real browser loop can be exercised
 * without the Next app. It plays the role of the PORTAL BACKEND, which is why (and the only reason)
 * it reads timecards through lib/data. The agent code (engine, provider, workflow) never does:
 * it reads hours off these pages like it would off the real portal.
 *
 * Run standalone:  npx tsx agent/test-fixtures/portal-stub.ts [--port 3014]
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadAllInvoices, loadTimecards, loadVendor } from "@/lib/data";
import { LABOR_LINE_REGEX } from "@/contracts";

const USER = "ap.reviewer";
const PASS = "demo-only";
const COOKIE = "portal_session";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · Fixture vendor portal (TEST STUB)</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1a1a1a}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:6px 10px;text-align:left}
.num{text-align:right;font-variant-numeric:tabular-nums}.banner{background:#fff4d6;padding:6px 10px;margin-bottom:16px;font-size:13px}.err{color:#b00020}</style></head>
<body><div class="banner">Unofficial demo inspired by Ramp's design · TEST STUB of the fixture vendor portal — synthetic data</div>
<nav><a href="/portal/invoices">Invoices</a> · <a href="/portal/employees">Employees</a></nav>
<h1>${esc(title)}</h1>${body}</body></html>`;
}

function weekEnding(invoiceLines: { description: string }[]): string | null {
  for (const l of invoiceLines) {
    const m = LABOR_LINE_REGEX.exec(l.description);
    if (m) return m[3];
  }
  return null;
}

function hasSession(req: http.IncomingMessage): boolean {
  return (req.headers.cookie ?? "").split(/;\s*/).some((c) => c.startsWith(`${COOKIE}=`));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

export function createPortalStubHandler() {
  const vendor = loadVendor();
  const invoices = loadAllInvoices();
  const timecards = loadTimecards(); // portal BACKEND data (stub only)
  const empByName = new Map(vendor.employees.map((e) => [e.name.toLowerCase(), e]));

  return async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };
    const redirect = (to: string, status = 303, headers: Record<string, string> = {}) => {
      res.writeHead(status, { location: to, ...headers });
      res.end();
    };
    const p = url.pathname.replace(/\/+$/, "") || "/";

    if (p === "/") return redirect("/portal/login", 302);
    if (p === "/__stub/external-probe") {
      // Test-only page that tries to load an external resource (the driver must block it).
      return send(200, page("External probe", `<img alt="external" src="https://example.com/probe.png"><p>probe</p>`));
    }

    if (p === "/portal/login" && req.method === "GET") {
      const err = url.searchParams.get("error") ? `<p class="err" role="alert">Invalid username or password.</p>` : "";
      return send(
        200,
        page(
          "Sign in",
          `${err}<form method="post" action="/api/portal/login">
<p><label for="username">Username</label> <input id="username" name="username" autocomplete="username"></p>
<p><label for="password">Password</label> <input id="password" name="password" type="password"></p>
<button type="submit">Sign in</button></form>
<p>Demo credentials: username <code>${USER}</code>, password <code>${PASS}</code></p>`,
        ),
      );
    }

    if (p === "/api/portal/login" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      if (form.get("username") === USER && form.get("password") === PASS) {
        return redirect("/portal/invoices", 303, { "set-cookie": `${COOKIE}=stub-session; Path=/; HttpOnly; SameSite=Lax` });
      }
      return redirect("/portal/login?error=1", 303);
    }

    if (!p.startsWith("/portal/")) return send(404, page("Not found", "<p>Not found</p>"));
    if (!hasSession(req)) return redirect("/portal/login", 302);

    if (p === "/portal/invoices") {
      const rows = invoices
        .map((i) => `<tr><td><a href="/portal/invoices/${esc(i.invoice_id)}">${esc(i.invoice_id)}</a></td><td>${esc(weekEnding(i.line_items) ?? "")}</td><td class="num">${money(i.total)}</td></tr>`)
        .join("");
      return send(200, page("Invoices", `<table><thead><tr><th>Invoice</th><th>Week ending</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>`));
    }

    const inv = /^\/portal\/invoices\/([^/]+)$/.exec(p);
    if (inv) {
      const invoice = invoices.find((i) => i.invoice_id === decodeURIComponent(inv[1]));
      if (!invoice) return send(404, page("Invoice not found", "<p>No invoice found</p>"));
      const rows = invoice.line_items
        .map((li, idx) => {
          const m = LABOR_LINE_REGEX.exec(li.description);
          const emp = m ? empByName.get(m[1].toLowerCase()) : undefined;
          const link = m && emp ? `<a href="/portal/employees/${esc(emp.employee_id)}?week=${esc(m[3])}">View timecard</a>` : "";
          return `<tr><td>${idx + 1}</td><td>${esc(li.description)}</td><td class="num">${li.quantity}</td><td class="num">${li.unit_rate.toFixed(2)}</td><td class="num">${money(li.amount)}</td><td>${link}</td></tr>`;
        })
        .join("");
      return send(
        200,
        page(
          `Invoice ${invoice.invoice_id}`,
          `<p>Vendor: ${esc(invoice.vendor)} · Issued ${esc(invoice.issue_date)} · Due ${esc(invoice.due_date)} · Total <span class="num">${money(invoice.total)}</span></p>
<table><thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th>Timecard</th></tr></thead><tbody>${rows}</tbody></table>`,
        ),
      );
    }

    if (p === "/portal/employees") {
      const rows = vendor.employees
        .map((e) => `<tr><td><a href="/portal/employees/${esc(e.employee_id)}">${esc(e.name)}</a></td><td>${esc(e.employee_id)}</td><td>${esc(e.role)}</td></tr>`)
        .join("");
      return send(200, page("Employees", `<table><tbody>${rows}</tbody></table>`));
    }

    const emp = /^\/portal\/employees\/([^/]+)$/.exec(p);
    if (emp) {
      const id = decodeURIComponent(emp[1]);
      const e = vendor.employees.find((x) => x.employee_id === id);
      const week = url.searchParams.get("week");
      if (week) {
        const tc = timecards.find((t) => t.employee_id === id && t.week_ending === week);
        if (!e || !tc) return send(200, page("Timecard", `<p>No timecard found for ${esc(id)}, week ending ${esc(week)}.</p>`));
        const field = (label: string, name: string, v: unknown) =>
          `<tr><th>${esc(label)}</th><td><span data-field="${name}">${esc(v)}</span></td></tr>`;
        return send(
          200,
          page(
            `Timecard — ${e.name}, week ending ${week}`,
            `<table><tbody>${field("Employee ID", "employee_id", e.employee_id)}${field("Employee", "employee_name", e.name)}${field("Role", "role", e.role)}${field("Week ending", "week_ending", tc.week_ending)}${field("Approved hours", "approved_hours", tc.approved_hours)}${field("Status", "status", tc.status)}${field("Approved by", "approved_by", tc.approved_by)}</tbody></table>`,
          ),
        );
      }
      if (!e) return send(404, page("Employee not found", "<p>No employee found</p>"));
      const weeks = timecards.filter((t) => t.employee_id === id).map((t) => t.week_ending).sort();
      return send(200, page(e.name, `<ul>${weeks.map((w) => `<li><a href="/portal/employees/${esc(id)}?week=${w}">Week ending ${w}</a></li>`).join("")}</ul>`));
    }

    return send(404, page("Not found", "<p>Not found</p>"));
  };
}

export async function startPortalStub(port = 0): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const handle = createPortalStubHandler();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Standalone: npx tsx agent/test-fixtures/portal-stub.ts --port 3014
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--port");
  const port = i > -1 ? Number(process.argv[i + 1]) : 3014;
  startPortalStub(port).then((s) => console.log(`[TEST STUB] fixture portal stub listening on ${s.url}`));
}
