"use client";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Rocket, RefreshCw, Eye, Trash2, Plus, Minus } from "lucide-react";
import axios from "@/lib/axios";
import { Pagination, PaginationData } from "@/components/ui/pagination";
import { useDatasets, Dataset } from "@/hooks/useDatasets";
import { useTranslations } from "next-intl";
import * as d3 from "d3";

interface Triple {
  head: string;
  relation: string;
  tail: string;
}

interface GraphNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  label: string;
}

export default function GraphPage() {
  const t = useTranslations("graph");
  const tc = useTranslations("common");
  const { datasets, loading: datasetsLoading, refresh } = useDatasets();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [graphingId, setGraphingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [triples, setTriples] = useState<Triple[]>([]);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    total: 0,
    total_pages: 1,
  });
  const pageSize = 10;

  useEffect(() => {
    // 默认选择第一个数据集
    if (datasets.length > 0 && !selectedDatasetId) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets]);

  useEffect(() => {
    if (selectedDatasetId) {
      fetchDatasetGraph(selectedDatasetId);
    }
  }, [selectedDatasetId]);

  // 分页相关
  const totalDatasets = datasets.length;
  const pagedDatasets = datasets.slice(
    (pagination.page - 1) * pageSize,
    pagination.page * pageSize
  );

  // 更新分页信息
  useEffect(() => {
    setPagination((prev) => ({
      ...prev,
      total: totalDatasets,
      total_pages: Math.ceil(totalDatasets / pageSize),
    }));
  }, [totalDatasets, pageSize]);

  // 切换页码时，若当前选中数据集不在本页，自动选中本页第一个
  useEffect(() => {
    if (pagedDatasets.length === 0) return;
    if (!pagedDatasets.some((d) => d.id === selectedDatasetId)) {
      setSelectedDatasetId(pagedDatasets[0].id);
    }
  }, [pagination.page, datasets]);

  const fetchDatasetGraph = async (datasetId: string) => {
    setLoadingGraph(true);
    try {
      const params = new URLSearchParams();
      params.append("dataset_id", datasetId);

      const res = await axios.get(`/api/knowledge/graph?${params}`);
      const data = res.data;
      setTriples(data.triples || []);
    } catch (error) {
      console.error("Failed to fetch graph:", error);
      setTriples([]);
    } finally {
      setLoadingGraph(false);
    }
  };

  const handleGenerateGraph = async (dataset: Dataset) => {
    setGraphingId(dataset.id);
    try {
      const res = await axios.post(`/api/knowledge/graph?id=${dataset.id}`);
      const data = res.data;

      if (data.success && data.task_id) {
        await refresh();

        const taskId = data.task_id;
        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = 5000;

        const pollTask = async () => {
          try {
            const taskRes = await axios.get(`/api/datasets/tasks/${taskId}`);
            const taskData = taskRes.data;

            if (taskData.success && taskData.task) {
              const task = taskData.task;

              if (task.status === "done" || task.status === "completed") {
                console.log("Graph generation task completed:", task.result);
                await refresh();
                await fetchDatasetGraph(dataset.id);
                setGraphingId(null);
                return;
              } else if (task.status === "failed" || task.status === "error") {
                console.error("Graph generation task failed:", task.error_detail);
                await refresh();
                setGraphingId(null);
                return;
              } else if (task.status === "processing" || task.status === "pending") {
                await refresh();

                attempts++;
                if (attempts < maxAttempts) {
                  setTimeout(pollTask, pollInterval);
                } else {
                  console.warn("Task polling timeout");
                  await refresh();
                  setGraphingId(null);
                }
              } else {
                console.warn("Unknown task status:", task.status);
                await refresh();
                setGraphingId(null);
                return;
              }
            }
          } catch (error) {
            console.error("Failed to poll task status:", error);
            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(pollTask, pollInterval);
            } else {
              setGraphingId(null);
            }
          }
        };

        setTimeout(pollTask, pollInterval);
      } else {
        await refresh();
        await fetchDatasetGraph(dataset.id);
        setGraphingId(null);
      }
    } catch (error) {
      console.error("Failed to generate graph:", error);
      await refresh();
      setGraphingId(null);
    }
  };

  const handleDeleteGraph = async (dataset: Dataset) => {
    if (!window.confirm(t("deleteConfirm", { name: dataset.name }))) {
      return;
    }

    setDeletingId(dataset.id);
    try {
      await axios.delete(`/api/knowledge/graph?dataset_id=${dataset.id}`);
      await refresh();
      if (selectedDatasetId === dataset.id) {
        await fetchDatasetGraph(dataset.id);
      }
    } catch (error) {
      console.error("Failed to delete graph:", error);
    } finally {
      setDeletingId(null);
    }
  };

  // Initialize D3 graph
  useEffect(() => {
    if (!svgRef.current || triples.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // Clear previous graph
    svg.selectAll("*").remove();

    // Create main group for zoom/pan
    const g = svg.append("g");
    gRef.current = g;

    // Setup zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));

    svg.call(zoom);
    zoomRef.current = zoom;

    // Add arrow marker
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 26)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 4)
      .attr("markerHeight", 4)
      .append("path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#94a3b8");

    // Transform triples to nodes and links
    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    triples.forEach((triple) => {
      if (!nodeMap.has(triple.head)) {
        nodeMap.set(triple.head, { id: triple.head, label: triple.head });
      }
      if (!nodeMap.has(triple.tail)) {
        nodeMap.set(triple.tail, { id: triple.tail, label: triple.tail });
      }
      links.push({
        source: triple.head,
        target: triple.tail,
        label: triple.relation,
      });
    });

    const nodes = Array.from(nodeMap.values());

    // Calculate node degree
    const nodeDegree = new Map<string, number>();
    links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      nodeDegree.set(sourceId, (nodeDegree.get(sourceId) || 0) + 1);
      nodeDegree.set(targetId, (nodeDegree.get(targetId) || 0) + 1);
    });

    // Create force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(90)
          .strength(1)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(45));

    simulationRef.current = simulation;

    // Create links
    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // Create nodes
    const node = g
      .append("g")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node-group cursor-pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Main circle
    node
      .append("circle")
      .attr("r", (d) => {
        const degree = nodeDegree.get(d.id) || 0;
        return degree > 1 ? 12 + Math.min(degree, 10) * 2 : 12;
      })
      .attr("fill", "#ffffff")
      .attr("stroke", (d) => {
        const degree = nodeDegree.get(d.id) || 0;
        if (degree > 5) return "#6366f1";
        if (degree > 2) return "#8b5cf6";
        return "#e2e8f0";
      })
      .attr("stroke-width", 2)
      .style("filter", "drop-shadow(0 1px 2px rgba(0,0,0,0.1))");

    // Node icon/text
    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", ".35em")
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .attr("fill", "#64748b")
      .text("●");

    // Node labels (below node)
    const labels = node.append("g").attr("transform", "translate(0, 28)");

    labels
      .append("text")
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#334155")
      .text((d) => {
        // Truncate long labels
        const maxLength = 15;
        return d.label.length > maxLength ? d.label.substring(0, maxLength) + "..." : d.label;
      });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x || 0)
        .attr("y1", (d) => (d.source as GraphNode).y || 0)
        .attr("x2", (d) => (d.target as GraphNode).x || 0)
        .attr("y2", (d) => (d.target as GraphNode).y || 0);

      node.attr("transform", (d) => `translate(${d.x || 0},${d.y || 0})`);
    });

    // Auto zoom to fit after simulation stabilizes
    setTimeout(() => {
      if (!svgRef.current || !gRef.current) return;

      const bounds = g.node()?.getBBox();
      if (!bounds) return;

      const fullWidth = svgRef.current.clientWidth;
      const fullHeight = svgRef.current.clientHeight;
      const midX = bounds.x + bounds.width / 2;
      const midY = bounds.y + bounds.height / 2;

      const scale = 0.9 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
      const clampedScale = Math.min(Math.max(scale, 0.3), 1.5);

      const translate = [fullWidth / 2 - clampedScale * midX, fullHeight / 2 - clampedScale * midY];

      svg
        .transition()
        .duration(750)
        .call(
          zoom.transform,
          d3.zoomIdentity.translate(translate[0], translate[1]).scale(clampedScale)
        );
    }, 1000);

    return () => {
      simulation.stop();
    };
  }, [triples]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current);
      svg
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 1 / 1.3);
    }
  };

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);
  const entityCount = Array.from(new Set(triples.flatMap((t) => [t.head, t.tail]))).length;

  return (
    <div className="flex h-[calc(100vh-80px)]">
      {/* 左侧图谱区 */}
      <div className="w-2/3 p-4 border-r flex flex-col">
        <div className="font-bold text-lg mb-2 flex items-center gap-2">
          {selectedDataset && (
            <span className="text-sm font-normal text-muted-foreground">
              {selectedDataset.name}
            </span>
          )}
          {loadingGraph && <RefreshCw className="animate-spin w-4 h-4" />}
        </div>
        <div className="relative flex-1 min-h-0 rounded shadow-sm bg-gray-100 border border-gray-300">
          {triples.length === 0 ? (
            <div className="text-center text-muted-foreground mt-20">{t("noGraphData")}</div>
          ) : (
            <svg ref={svgRef} className="w-full h-full focus:outline-none" />
          )}
          {/* 左下角实体数量 */}
          {triples.length > 0 && (
            <div className="absolute left-4 bottom-4 bg-white/90 backdrop-blur-sm border border-gray-100 rounded px-3 py-1.5 text-xs shadow-sm">
              {t("entityCount")}: {entityCount}
            </div>
          )}
          {/* 右上角缩放按钮 */}
          {triples.length > 0 && (
            <div className="absolute right-4 top-4 flex gap-2">
              <button
                onClick={handleZoomIn}
                className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded p-2 shadow-sm hover:bg-white transition-colors flex items-center justify-center"
                title={t("zoomIn")}
              >
                <Plus className="w-4 h-4 text-gray-600" />
              </button>
              <button
                onClick={handleZoomOut}
                className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded p-2 shadow-sm hover:bg-white transition-colors flex items-center justify-center"
                title={t("zoomOut")}
              >
                <Minus className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          )}
        </div>
      </div>
      {/* 右侧数据集列表 */}
      <div className="w-1/3 p-4 flex flex-col h-full">
        <Card className="flex-1 flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">{t("datasetList")}</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            {datasetsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border border-border border-t-blue-500 rounded-full animate-spin"></div>
                  <span>{tc("loading")}</span>
                </div>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50%]">{t("name")}</TableHead>
                      <TableHead className="w-[25%]">{t("status")}</TableHead>
                      <TableHead className="w-[25%]">{t("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datasets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          {t("noDatasets")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedDatasets.map((dataset) => {
                        const graphStatus = dataset.graph_status || "pending";
                        return (
                          <TableRow
                            key={dataset.id}
                            className={`cursor-pointer hover:bg-muted ${selectedDatasetId === dataset.id ? "bg-blue-50" : ""}`}
                            onClick={() => setSelectedDatasetId(dataset.id)}
                          >
                            <TableCell className="min-w-[200px]">
                              <div className="font-medium break-words">{dataset.name}</div>
                              {dataset.file_count !== undefined && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {dataset.file_count} {t("files")}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {graphStatus === "done" ? (
                                <Badge className="bg-green-100 text-green-800">
                                  {t("generated")}
                                </Badge>
                              ) : graphStatus === "processing" ? (
                                <Badge className="bg-yellow-100 text-yellow-800">
                                  {t("generating")}
                                </Badge>
                              ) : (
                                <Badge className="bg-muted text-foreground">
                                  {t("notGenerated")}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateGraph(dataset);
                                  }}
                                  disabled={
                                    graphStatus === "processing" || graphingId === dataset.id
                                  }
                                  title={t("generateGraph")}
                                >
                                  <Rocket
                                    className={`h-4 w-4 ${graphingId === dataset.id ? "animate-spin" : ""}`}
                                  />
                                </Button>
                                {graphStatus === "done" && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedDatasetId(dataset.id);
                                      }}
                                      title={t("showGraph")}
                                    >
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteGraph(dataset);
                                      }}
                                      disabled={deletingId === dataset.id}
                                      title={t("deleteGraph")}
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                {datasets.length > pageSize && (
                  <div className="sticky bottom-0 z-10 bg-card">
                    <Pagination
                      pagination={pagination}
                      onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
                      itemName={t("files")}
                      className="py-2 border-t mt-2"
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
