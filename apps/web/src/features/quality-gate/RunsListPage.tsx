import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeleteRun, useRuns } from "./queries";
import { GateStatusBadge } from "./components/GateStatusBadge";

export function RunsListPage() {
  const nav = useNavigate();
  const { data, isLoading } = useRuns({});
  const del = useDeleteRun();
  const items = data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">评测运行</h1>
        <Button onClick={() => nav("/quality-gate/runs/new")}>新建评测运行</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">加载中…</div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground">还没有评测运行</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>样本进度</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    className="text-primary hover:underline"
                    to={`/quality-gate/runs/${r.id}`}
                  >
                    {r.id.slice(0, 12)}
                  </Link>
                </TableCell>
                <TableCell>
                  <GateStatusBadge status={r.status} gateResult={r.gateResult} />
                </TableCell>
                <TableCell>
                  {r.processedSamples}/{r.totalSamples}
                </TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => nav(`/quality-gate/runs/${r.id}`)}
                  >
                    详情
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive">
                        删除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除 {r.id.slice(0, 12)}？</AlertDialogTitle>
                        <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate(r.id)}>
                          删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
