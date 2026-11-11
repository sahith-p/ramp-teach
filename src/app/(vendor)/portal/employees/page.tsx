import Link from "next/link";
import { loadTimecards, loadVendor } from "@/lib/data";
import { requirePortalSession } from "@/components/fixtures/require-session";
import { timecardsForEmployee } from "@/components/fixtures/portal-data";
import { PageTitle, PortalShell, Table, plink, td, tdMoney, th, thMoney } from "@/components/fixtures/FixtureChrome";

export const metadata = { title: "Employees · Halcyon Staffing client portal" };

export default async function PortalEmployees() {
  await requirePortalSession();
  const vendor = loadVendor();
  const timecards = loadTimecards();
  return (
    <PortalShell>
      <PageTitle>Employees</PageTitle>
      <Table caption="Employee roster">
        <thead>
          <tr>
            <th scope="col" className={th}>Employee ID</th>
            <th scope="col" className={th}>Name</th>
            <th scope="col" className={th}>Role</th>
            <th scope="col" className={thMoney}>Timecards</th>
            <th scope="col" className={th}>Latest week</th>
          </tr>
        </thead>
        <tbody>
          {vendor.employees.map((e) => {
            const cards = timecardsForEmployee(timecards, e.employee_id);
            return (
              <tr key={e.employee_id} data-employee-id={e.employee_id}>
                <th scope="row" className={`${td} text-left font-medium`}>
                  <Link href={`/portal/employees/${e.employee_id}`} className={plink}>
                    {e.employee_id}
                  </Link>
                </th>
                <td className={td}>
                  <Link href={`/portal/employees/${e.employee_id}`} className={plink}>
                    {e.name}
                  </Link>
                </td>
                <td className={td}>{e.role}</td>
                <td className={tdMoney}>{cards.length}</td>
                <td className={td}>{cards[0]?.week_ending ?? "None"}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </PortalShell>
  );
}
