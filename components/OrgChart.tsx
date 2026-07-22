"use client";
import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users } from "lucide-react";

interface Dept {
  id: number;
  name: string;
  tenant_id: number;
  tenant_name?: string;
  parent_id?: number | null;
  level?: number;
  path?: string;
  abbreviation?: string;
  status?: string;
  children?: Dept[];
}

interface Tenant {
  id: number;
  name: string;
  code: string;
  status: string;
}

interface OrgChartProps {
  depts: Dept[];
  tenant: Tenant;
  onClose: () => void;
}

// 租户节点组件
function TenantNode({ data }: NodeProps<{ tenant: Tenant; translations: any }>) {
  const { tenant, translations } = data;

  return (
    <Card className="min-w-[250px] shadow-lg border-2 border-primary/20 bg-gradient-to-br from-primary-50 to-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="font-bold text-primary text-lg">{tenant.name}</span>
        </div>

        <Badge variant="outline" className="text-xs mb-2">
          {tenant.code}
        </Badge>

        <Badge
          variant="outline"
          className={`text-xs ${
            tenant.status === "active"
              ? "bg-success/10 text-success border-success/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}
        >
          {tenant.status === "active" ? translations.statusActive : translations.statusInactive}
        </Badge>

        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          <span>{translations.tenantLower}</span>
        </div>
      </CardContent>

      {/* 连接点 */}
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </Card>
  );
}

// 部门节点组件
function DeptNode({ data }: NodeProps<{ dept: Dept; translations: any }>) {
  const { dept, translations } = data;

  return (
    <Card className="min-w-[200px] shadow-lg border-2 border-primary/20 bg-gradient-to-br from-primary-50 to-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-primary">{dept.name}</span>
        </div>

        {dept.abbreviation && (
          <Badge variant="outline" className="text-xs mb-2">
            {dept.abbreviation}
          </Badge>
        )}

        {dept.status && (
          <Badge
            variant="outline"
            className={`text-xs ${
              dept.status === "正常"
                ? "bg-success/10 text-success border-success/20"
                : "bg-destructive/10 text-destructive border-destructive/20"
            }`}
          >
            {dept.status}
          </Badge>
        )}

        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          <span>{translations.deptMembers}</span>
        </div>
      </CardContent>

      {/* 连接点 */}
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Top} id="top" />
    </Card>
  );
}

const nodeTypes = {
  tenant: TenantNode,
  dept: DeptNode,
};

export default function OrgChart({ depts, tenant, onClose }: OrgChartProps) {
  const t = useTranslations("common");

  // Prepare translations object
  const translations = useMemo(
    () => ({
      tenantLower: t("tenantLower"),
      deptMembers: t("deptMembers"),
      statusActive: t("statusActive"),
      statusInactive: t("statusInactive"),
    }),
    [t]
  );

  // 构建部门树结构
  const buildDeptTree = (depts: Dept[]): Dept[] => {
    const deptMap = new Map<number, Dept>();
    const roots: Dept[] = [];

    // 创建映射
    depts.forEach((dept) => {
      deptMap.set(dept.id, { ...dept, children: [] });
    });

    // 构建树结构
    depts.forEach((dept) => {
      const deptWithChildren = deptMap.get(dept.id)!;
      if (dept.parent_id && deptMap.has(dept.parent_id)) {
        const parent = deptMap.get(dept.parent_id)!;
        parent.children = parent.children || [];
        parent.children.push(deptWithChildren);
      } else {
        roots.push(deptWithChildren);
      }
    });

    return roots;
  };

  // 生成节点和边
  const { nodes, edges } = useMemo(() => {
    const deptTree = buildDeptTree(depts);
    const nodes: any[] = [];
    const edges: any[] = [];

    // 添加租户节点（最顶层）
    const tenantNodeId = `tenant-${tenant.id}`;
    nodes.push({
      id: tenantNodeId,
      type: "tenant",
      position: { x: 0, y: 0 },
      data: { tenant, translations },
    });

    // 递归生成节点和边
    const generateNodesAndEdges = (
      depts: Dept[],
      level: number = 1, // 从第1层开始，第0层是租户
      startX: number = 0,
      parentId?: string
    ): { nodes: any[]; edges: any[]; width: number } => {
      if (depts.length === 0) return { nodes: [], edges: [], width: 0 };

      const levelNodes: any[] = [];
      const levelEdges: any[] = [];
      let totalWidth = 0;
      const nodeWidth = 220; // 节点宽度
      const nodeHeight = 120; // 节点高度
      const levelGap = 200; // 层级间距
      const nodeGap = 50; // 同级节点间距

      depts.forEach((dept, index) => {
        const nodeId = `dept-${dept.id}`;
        const x = startX + totalWidth;
        const y = level * levelGap;

        // 添加节点
        levelNodes.push({
          id: nodeId,
          type: "dept",
          position: { x, y },
          data: { dept, translations },
        });

        // 添加边（连接到父节点）
        if (parentId) {
          levelEdges.push({
            id: `edge-${parentId}-${nodeId}`,
            source: parentId,
            target: nodeId,
            type: "smoothstep",
            style: {
              stroke: "#3b82f6",
              strokeWidth: 2,
              strokeDasharray: "5,5",
            },
            animated: true,
          });
        } else {
          // 如果没有父节点，连接到租户节点
          levelEdges.push({
            id: `edge-${tenantNodeId}-${nodeId}`,
            source: tenantNodeId,
            target: nodeId,
            type: "smoothstep",
            style: {
              stroke: "#8b5cf6",
              strokeWidth: 3,
              strokeDasharray: "8,4",
            },
            animated: true,
          });
        }

        // 递归处理子部门
        if (dept.children && dept.children.length > 0) {
          const childResult = generateNodesAndEdges(
            dept.children,
            level + 1,
            x - ((dept.children.length - 1) * nodeWidth) / 2,
            nodeId
          );
          levelNodes.push(...childResult.nodes);
          levelEdges.push(...childResult.edges);
          totalWidth = Math.max(totalWidth, childResult.width);
        }

        totalWidth += nodeWidth + nodeGap;
      });

      return {
        nodes: [...levelNodes],
        edges: [...levelEdges],
        width: totalWidth,
      };
    };

    const result = generateNodesAndEdges(deptTree);
    return {
      nodes: [nodes[0], ...result.nodes], // 租户节点 + 部门节点
      edges: result.edges,
    };
  }, [depts, tenant, translations]);

  const [reactFlowNodes, setReactFlowNodes, onNodesChange] = useNodesState(nodes);
  const [reactFlowEdges, setReactFlowEdges, onEdgesChange] = useEdgesState(edges);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">{t("orgChart")}</h2>
            <p className="text-muted-foreground">{t("deptHierarchyDisplay")}</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* 图表区域 */}
        <div className="flex-1 p-6">
          <div className="w-full h-full bg-gradient-to-br from-primary-50 to-secondary rounded-lg overflow-hidden">
            <ReactFlow
              nodes={reactFlowNodes}
              edges={reactFlowEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              fitView
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              minZoom={0.1}
              maxZoom={2}
            >
              <Background color="#e5e7eb" gap={24} />
              <Controls />
            </ReactFlow>
          </div>
        </div>

        {/* 底部信息 */}
        <div className="p-4 border-t bg-secondary">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              {t("tenantColon")} {tenant.name} | {t("totalDepts")} {depts.length} |{" "}
              {t("hierarchyLevels")} {Math.max(...depts.map((d) => d.level || 0)) + 1}
            </div>
            <div>{t("orgChartHint")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
