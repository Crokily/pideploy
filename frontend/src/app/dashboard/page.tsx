import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/");
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card
          title="Welcome Back"
          description="Manage your OpenClaw runtime and deployment resources from one place."
          variant="default"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm text-secondary-600">Authenticated user</p>
              <code className="inline-flex rounded-lg bg-secondary-100 px-2.5 py-1 font-mono text-xs text-secondary-700">
                {userId}
              </code>
            </div>
            <Badge variant="info">Connected</Badge>
          </div>
        </Card>

        <Card
          title="Instances"
          description="Create your first deployment to start using your personal assistant."
          variant="elevated"
        >
          <EmptyState
            title="No instances yet"
            description="Spin up your first instance in under a minute. You can manage status, logs and updates from this dashboard."
          />

          <div className="mt-6">
            <form action="/dashboard/new">
              <Button
                type="submit"
                rightIcon={
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7.5 5L12.5 10L7.5 15"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
              >
                Create New Instance
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
