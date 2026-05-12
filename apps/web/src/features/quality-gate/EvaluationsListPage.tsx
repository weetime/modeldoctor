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
import { useDeleteEvaluation, useEvaluations } from "./queries";

export function EvaluationsListPage() {
  const nav = useNavigate();
  const { data, isLoading } = useEvaluations();
  const del = useDeleteEvaluation();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">评测集</h1>
        <Button onClick={() => nav("/quality-gate/evaluations/new")}>新建评测集</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">加载中…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-muted-foreground">还没有评测集</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>样本数</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link
                    className="text-primary hover:underline"
                    to={`/quality-gate/evaluations/${e.id}`}
                  >
                    {e.name}
                  </Link>
                </TableCell>
                <TableCell>{e.totalSamples}</TableCell>
                <TableCell>{new Date(e.updatedAt).toLocaleString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => nav(`/quality-gate/evaluations/${e.id}`)}
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
                        <AlertDialogTitle>删除 {e.name}？</AlertDialogTitle>
                        <AlertDialogDescription>
                          此操作不可撤销。如有关联评测运行将被拒绝。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate(e.id)}>
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
