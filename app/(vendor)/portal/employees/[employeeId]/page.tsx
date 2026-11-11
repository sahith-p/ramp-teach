import Link from "next/link";
import { loadTimecards, loadVendor } from "@/lib/data";
import { requirePortalSession } from "@/components/fixtures/require-session";
import {
  findEmployeeById,
  findTimecard,
  firstParam,
  timecardHref,
  timecardsForEmployee,
} from "@/components/fixtures/portal-data";
import { Field, PageTitle, PortalShell, Table, plink, td, tdMoney, th, thMoney } from "@/components/fixtures/FixtureChrome";

export const metadata = { title: "Timecards · Halcyon Staffing client portal" };

function NoTimecard({ employeeId, week, known }: { employeeId: string; week?: string; known: boolean }) {
  return (
    <PortalShell>
      <PageTitle>No timecard found</PageTitle>
      <p className="text-sm" data-testid="no-timecard">
        No timecard found for <code>{employeeId}</code>
        {week ? (
          <>
            {" "}
            for the week ending <code>{week}</code>
          </>
        ) : null}
        .{known ? "" : " Not on the roster."}
      </p>
      <p className="mt-4 text-sm">
        {known ? (
          <Link href={`/portal/employees/${employeeId}`} className={plink}>
            All timecards for {employeeId}
          </Link>
        ) : (
          <Link href="/portal/employees" className={plink}>
            Back to employees
          </Link>
        )}
      </p>
    </PortalShell>
  );
}

export default async function PortalEmployee({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePortalSession();
  const employeeId = decodeURIComponent((await params).employeeId);
  const week = firstParam((await searchParams).week)?.trim() || undefined;

  const vendor = loadVendor();
  const employee = findEmployeeById(vendor, employeeId);
  if (!employee) return <NoTimecard employeeId={employeeId} week={week} known={false} />;

  const timecards = loadTimecards();

  /* ---------------------------- timecard page (?week=) --------------------------- */
  if (week) {
    const tc = findTimecard(timecards, employee.employee_id, week);
    if (!tc) return <NoTimecard employeeId={employee.employee_id} week={week} known />;
    return (
      <PortalShell>
        <p className="mb-3 text-sm">
          <Link href={`/portal/employees/${employee.employee_id}`} className={plink}>
            ← {employee.name}
          </Link>
        </p>
        <PageTitle>Timecard</PageTitle>
        <dl className="grid max-w-2xl grid-cols-1 gap-6 rounded-md border border-line p-6 sm:grid-cols-2">
          <Field label="Employee ID" field="employee_id">{employee.employee_id}</Field>
          <Field label="Employee name" field="employee_name">{employee.name}</Field>
          <Field label="Role" field="role">{employee.role}</Field>
          <Field label="Week ending" field="week_ending">{tc.week_ending}</Field>
          <Field label="Approved hours" field="approved_hours">{tc.approved_hours}</Field>
          <Field label="Status" field="status">{tc.status}</Field>
          <Field label="Approved by" field="approved_by">{tc.approved_by}</Field>
        </dl>
      </PortalShell>
    );
  }

  /* ------------------------------ employee weeks list ----------------------------- */
  const cards = timecardsForEmployee(timecards, employee.employee_id);
  return (
    <PortalShell>
      <p className="mb-3 text-sm">
        <Link href="/portal/employees" className={plink}>
          ← Employees
        </Link>
      </p>
      <PageTitle sub={`${employee.employee_id} · ${employee.role}`}>{employee.name}</PageTitle>
      {cards.length === 0 ? (
        <p className="text-sm text-ink-muted">No timecard found for this employee.</p>
      ) : (
        <Table caption={`Timecards for ${employee.name}`}>
          <thead>
            <tr>
              <th scope="col" className={th}>Week ending</th>
              <th scope="col" className={thMoney}>Approved hours</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Approved by</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.week_ending} data-week={c.week_ending}>
                <th scope="row" className={`${td} text-left font-medium`}>
                  <Link href={timecardHref(employee.employee_id, c.week_ending)} className={plink}>
                    {c.week_ending}
                  </Link>
                </th>
                <td className={tdMoney}>{c.approved_hours}</td>
                <td className={td}>{c.status}</td>
                <td className={td}>{c.approved_by}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </PortalShell>
  );
}
